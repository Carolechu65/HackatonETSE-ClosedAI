import type { AlarmCommand, OperationKind, OperationReceipt } from '../../domain/contracts/types.ts';
import { parseAlarmRequestDocument, parseRecipientDocument, parseScheduleDocument, parseOperation, parseOperationReceipt } from '../../domain/contracts/validate.ts';
import type { AlarmGateway, AlarmRecord, SyncPage } from '../model.ts';
import { HttpClient, remoteError } from './http.ts';
import { SessionManager, type AuthSession, type SessionView } from './session.ts';

/** P1/P3 must supply their agreed wrappers. There is deliberately no default wire protocol. */
export interface HttpWireCodec {
  /** Negotiated server projection; omitted keeps the canonical entity feed. */
  syncPath?: string;
  decodeSession(body: unknown): AuthSession;
  decodeMe(body: unknown): { userId: string };
  decodeSyncPage(body: unknown): SyncPage;
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(value)) throw remoteError('INVALID_ARGUMENT');
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw remoteError('INVALID_ARGUMENT');
}
function cursor(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw remoteError('INVALID_ARGUMENT');
}
function safelyDecode<T>(decode: () => T): T {
  try { return decode(); } catch { throw remoteError('INVALID_ARGUMENT'); }
}

/** Validates normalized transport data again; a codec cannot bypass domain/authorization checks. */
export function validateAlarmRecord(value: AlarmRecord, userId: string): AlarmRecord {
  return safelyDecode(() => {
    identifier(value.groupId); identifier(value.requestId);
    const request = parseAlarmRequestDocument(value.request);
    const recipient = parseRecipientDocument(value.recipient);
    if (!request.recipientUids.includes(recipient.uid)
      || (userId !== request.creatorUid && userId !== recipient.uid)
      || new Set(request.recipientUids).size !== request.recipientUids.length
      || recipient.receivedVersion > request.requestVersion
      || (recipient.acceptedRequestVersion ?? 0) > request.requestVersion
      || request.updatedAtEpochMs < request.createdAtEpochMs
      || (recipient.decision === 'ACCEPTED' && !recipient.consentScope)
      || (recipient.decision !== 'ACCEPTED' && (recipient.chosenTimeSpec || recipient.consentScope))) {
      throw remoteError('INVALID_ARGUMENT');
    }
    let primaryDevice: AlarmRecord['primaryDevice'] = null;
    if (value.primaryDevice !== null) {
      identifier(value.primaryDevice.deviceId); integer(value.primaryDevice.deviceEpoch, 1);
      primaryDevice = { deviceId: value.primaryDevice.deviceId, deviceEpoch: value.primaryDevice.deviceEpoch };
    }
    if (!Array.isArray(value.schedules) || value.schedules.length > 128) throw remoteError('INVALID_ARGUMENT');
    const seen = new Set<string>();
    const schedules = value.schedules.map(raw => {
      const schedule = parseScheduleDocument(raw);
      const identity = `${schedule.occurrenceId}/${schedule.deviceId}/${schedule.deviceEpoch}`;
      if (seen.has(identity) || schedule.requestVersion > request.requestVersion
        || schedule.decisionRevision > recipient.decisionRevision || schedule.mode !== request.mode
        || (schedule.mode === 'ALARM' ? schedule.mechanism !== 'ALARM_RUNTIME' : schedule.mechanism !== 'EXPO_NOTIFICATIONS')
        || (primaryDevice && schedule.deviceEpoch > primaryDevice.deviceEpoch)
        || ((schedule.status === 'FAILED' || schedule.status === 'PENDING_PERMISSION') && !schedule.reason)) {
        throw remoteError('INVALID_ARGUMENT');
      }
      seen.add(identity); return schedule;
    });
    return { groupId: value.groupId, requestId: value.requestId, request, recipient, primaryDevice, schedules };
  });
}

export function validateSyncPage(value: SyncPage, userId: string, previousCursor: string | null): SyncPage {
  return safelyDecode(() => {
    cursor(value.nextCursor); integer(value.serverTimeEpochMs);
    if (typeof value.hasMore !== 'boolean' || !Array.isArray(value.events) || value.events.length > 200
      || (value.hasMore && value.nextCursor === previousCursor)) throw remoteError('INVALID_ARGUMENT');
    const seen = new Set<string>();
    const events = value.events.map(event => {
      identifier(event.eventId);
      if (seen.has(event.eventId)) throw remoteError('INVALID_ARGUMENT');
      seen.add(event.eventId);
      if (event.kind === 'upsert') return { eventId: event.eventId, kind: 'upsert' as const, alarm: validateAlarmRecord(event.alarm, userId) };
      if (event.kind !== 'revoke') throw remoteError('INVALID_ARGUMENT');
      identifier(event.groupId);
      if (event.requestId !== undefined) identifier(event.requestId);
      return { eventId: event.eventId, kind: 'revoke' as const, groupId: event.groupId, ...(event.requestId === undefined ? {} : { requestId: event.requestId }) };
    });
    return { events, nextCursor: value.nextCursor, hasMore: value.hasMore, serverTimeEpochMs: value.serverTimeEpochMs };
  });
}

export class HttpAlarmGateway implements AlarmGateway {
  private readonly http: HttpClient;
  private readonly sessions: SessionManager;
  private readonly codec: HttpWireCodec;
  constructor(http: HttpClient, sessions: SessionManager, codec: HttpWireCodec) { this.http = http; this.sessions = sessions; this.codec = codec; }
  async execute(kind: OperationKind, command: AlarmCommand): Promise<OperationReceipt> {
    const lease = this.sessions.lease();
    // Validate, but send the original persisted payload verbatim across retries.
    if (!['createAlarmRequest', 'respondToAlarm', 'reportSchedule', 'withdrawAlarmRequest'].includes(kind)) throw remoteError('INVALID_ARGUMENT');
    safelyDecode(() => parseOperation(kind, command));
    const result = await this.http.authenticatedJson(`/v1/operations/${kind}`, 'POST', command, lease);
    lease.assertCurrent();
    const receipt = safelyDecode(() => parseOperationReceipt(result));
    if (receipt.operationId !== command.operationId) throw remoteError('INVALID_ARGUMENT');
    return receipt;
  }
  async sync(previousCursor: string | null): Promise<SyncPage> {
    const lease = this.sessions.lease();
    if (previousCursor !== null) cursor(previousCursor);
    const path = this.codec.syncPath ?? '/v1/sync';
    const query = previousCursor === null ? '' : `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(previousCursor)}`;
    const result = await this.http.authenticatedJson(`${path}${query}`, 'GET', undefined, lease);
    lease.assertCurrent();
    return validateSyncPage(safelyDecode(() => this.codec.decodeSyncPage(result)), lease.userId, previousCursor);
  }
}

export class HttpAuthClient {
  private readonly http: HttpClient;
  private readonly sessions: SessionManager;
  private readonly codec: HttpWireCodec;
  private readonly beforeInstall?: (session: AuthSession) => Promise<void>;
  constructor(http: HttpClient, sessions: SessionManager, codec: HttpWireCodec, beforeInstall?: (session: AuthSession) => Promise<void>) {
    this.http = http; this.sessions = sessions; this.codec = codec; this.beforeInstall = beforeInstall;
  }
  login(payload: unknown): Promise<SessionView> { return this.authenticate('login', payload); }
  register(payload: unknown): Promise<SessionView> { return this.authenticate('register', payload); }
  private async authenticate(action: 'login' | 'register', payload: unknown): Promise<SessionView> {
    const guard = this.sessions.guard();
    const result = await this.http.anonymousJson(`/v1/auth/${action}`, 'POST', payload, guard);
    guard.assertCurrent();
    const session = safelyDecode(() => this.codec.decodeSession(result));
    await this.beforeInstall?.(session);
    guard.assertCurrent();
    await this.sessions.install(session);
    return this.sessions.view();
  }
  async me(): Promise<{ userId: string }> {
    const lease = this.sessions.lease();
    const result = await this.http.authenticatedJson('/v1/auth/me', 'GET', undefined, lease);
    lease.assertCurrent();
    return safelyDecode(() => {
      const me = this.codec.decodeMe(result);
      identifier(me.userId);
      if (me.userId !== lease.userId) throw remoteError('INVALID_ARGUMENT');
      return { userId: me.userId };
    });
  }
  /** The service MUST cancel alarms/clear private projections before clearing SessionManager. */
  async logoutRemote(): Promise<void> { await this.http.authenticatedJson('/v1/auth/logout', 'POST'); }
}
