import { DomainError } from '../../domain/errors.ts';
import type { AppErrorCode } from '../../domain/errors.ts';
import type { AlarmCommand, OperationKind, OperationReceipt, RespondToAlarm, ReportSchedule } from '../../domain/contracts/types.ts';
import { occurrenceKey } from '../../domain/ids.ts';
import { canonicalJson, type AlarmRecord, type CancellationBarrier, type LocalSchedule, type PendingOperation, type SyncPage } from '../model.ts';
import { LocalDatabase, type SqlDatabase } from './database.ts';

type JsonRow = { body: string };
type OutboxRow = {
  operation_id: string; kind: OperationKind; command: string; lane: PendingOperation['lane'];
  state: PendingOperation['state']; attempts: number; next_attempt_at: number; created_at: number;
  error_code: AppErrorCode | null; receipt: string | null;
};
const decodeOperation = (row: OutboxRow): PendingOperation => ({
  operationId: row.operation_id, kind: row.kind, command: JSON.parse(row.command), lane: row.lane,
  state: row.state, attempts: row.attempts, nextAttemptAt: row.next_attempt_at, createdAt: row.created_at,
  ...(row.error_code ? { errorCode: row.error_code } : {}),
  ...(row.receipt ? { receipt: JSON.parse(row.receipt) as OperationReceipt } : {}),
});

async function insertOperation(db: SqlDatabase, userId: string, kind: OperationKind, command: AlarmCommand,
  now: number, lane: PendingOperation['lane']): Promise<boolean> {
  const encoded = canonicalJson(command);
  const previous = await db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE user_id=? AND operation_id=?', userId, command.operationId);
  if (previous) {
    if (previous.kind !== kind || previous.command !== encoded || previous.lane !== lane) {
      throw new DomainError('VERSION_CONFLICT', 'Este identificador ya pertenece a otra acción.');
    }
    return false;
  }
  await db.runAsync(`INSERT INTO outbox(user_id,operation_id,group_id,request_id,kind,lane,command,state,next_attempt_at,created_at)
    VALUES(?,?,?,?,?,?,?,'QUEUED',?,?)`, userId, command.operationId, command.groupId, command.entityId ?? null,
  kind, lane, encoded, now, now);
  return true;
}

function obsoleteAckCode(command: AlarmCommand, alarm: AlarmRecord): AppErrorCode | null {
  const payload = (command as ReportSchedule).payload;
  if (!alarm.primaryDevice || payload.deviceId !== alarm.primaryDevice.deviceId
    || payload.deviceEpoch !== alarm.primaryDevice.deviceEpoch) return 'DEVICE_NOT_PRIMARY';
  if (payload.requestVersion !== alarm.request.requestVersion
    || payload.decisionRevision !== alarm.recipient.decisionRevision) return 'VERSION_CONFLICT';
  return null;
}

async function ackProjection(db: SqlDatabase, userId: string, command: AlarmCommand): Promise<AlarmRecord | null> {
  const row = await db.getFirstAsync<JsonRow>(
    'SELECT body FROM projections WHERE user_id=? AND group_id=? AND request_id=? AND recipient_uid=?',
    userId, command.groupId, command.entityId!, userId);
  return row ? JSON.parse(row.body) as AlarmRecord : null;
}

export class LocalStore {
  readonly database: LocalDatabase;
  constructor(database: LocalDatabase) { this.database = database; }

  accountOwner(): Promise<string | null> {
    return this.database.read(async db => (await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM account_owner WHERE singleton=1'))?.user_id ?? null);
  }
  bindAccount(userId: string): Promise<void> {
    if (typeof userId !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(userId)) return Promise.reject(new DomainError('INVALID_ARGUMENT', 'Identificador de cuenta inválido.'));
    return this.database.transaction(async db => {
      const owner = await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM account_owner WHERE singleton=1');
      if (owner && owner.user_id !== userId) throw new DomainError('FORBIDDEN', 'Cancela y limpia la cuenta local antes de cambiar de usuario.');
      await db.runAsync('INSERT OR IGNORE INTO account_owner(singleton,user_id) VALUES(1,?)', userId);
    });
  }

  async enqueue(userId: string, kind: OperationKind, command: AlarmCommand, now: number): Promise<void> {
    await this.database.transaction(async db => {
      const inserted = await insertOperation(db, userId, kind, command, now, 'COMMAND');
      if (!inserted || kind !== 'respondToAlarm') return;
      const response = command as RespondToAlarm;
      if (response.payload.decision === 'ACCEPTED') return;
      const barrier: CancellationBarrier = { groupId: command.groupId, requestId: command.entityId!,
        requestVersion: command.expectedRequestVersion!, decisionRevision: command.expectedDecisionRevision!, operationId: command.operationId };
      await db.runAsync(`INSERT INTO cancellation_barriers VALUES(?,?,?,?)
        ON CONFLICT(user_id,group_id,request_id) DO UPDATE SET body=excluded.body`, userId, barrier.groupId, barrier.requestId, JSON.stringify(barrier));
    });
  }

  operations(userId: string): Promise<PendingOperation[]> {
    return this.database.read(async db => (await db.getAllAsync<OutboxRow>('SELECT * FROM outbox WHERE user_id=? ORDER BY sequence', userId)).map(decodeOperation));
  }

  /** Atomic claim and FIFO per entity: a delayed acceptance cannot overtake a disable. */
  claim(userId: string, now: number): Promise<PendingOperation | null> {
    return this.database.transaction(async db => {
      const row = await db.getFirstAsync<OutboxRow>(`SELECT o.* FROM outbox o WHERE user_id=? AND state='QUEUED' AND next_attempt_at<=?
        AND NOT EXISTS(SELECT 1 FROM outbox p WHERE p.user_id=o.user_id AND p.sequence<o.sequence
          AND p.group_id=o.group_id AND p.request_id IS o.request_id AND p.lane=o.lane AND p.state IN ('QUEUED','SENDING'))
        ORDER BY CASE lane WHEN 'COMMAND' THEN 0 ELSE 1 END, sequence LIMIT 1`, userId, now);
      if (!row) return null;
      await db.runAsync("UPDATE outbox SET state='SENDING', attempts=attempts+1 WHERE user_id=? AND operation_id=?", userId, row.operation_id);
      return { ...decodeOperation(row), state: 'SENDING', attempts: row.attempts + 1 };
    });
  }

  settle(userId: string, operationId: string, state: PendingOperation['state'], options: {
    receipt?: OperationReceipt; errorCode?: AppErrorCode; nextAttemptAt?: number;
  } = {}): Promise<void> {
    return this.database.transaction(async db => {
      await db.runAsync(`UPDATE outbox SET state=?,receipt=?,error_code=?,next_attempt_at=COALESCE(?,next_attempt_at)
        WHERE user_id=? AND operation_id=? AND state='SENDING'`, state, options.receipt ? JSON.stringify(options.receipt) : null,
      options.errorCode ?? null, options.nextAttemptAt ?? null, userId, operationId);
    });
  }

  /** Recheck a claimed row after a concurrent feed invalidation, before crossing the HTTP boundary. */
  canSendOperation(userId: string, operationId: string): Promise<boolean> {
    return this.database.transaction(async db => {
      const row = await db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE user_id=? AND operation_id=?', userId, operationId);
      if (!row || row.state !== 'SENDING') return false;
      if (row.lane === 'ACK') {
        const operation = decodeOperation(row);
        const alarm = await ackProjection(db, userId, operation.command);
        const code = alarm && obsoleteAckCode(operation.command, alarm);
        if (code) {
          await db.runAsync("UPDATE outbox SET state='FAILED_PERMANENT',error_code=? WHERE user_id=? AND operation_id=? AND state='SENDING'", code, userId, operationId);
          return false;
        }
      }
      return true;
    });
  }

  /** Explicit user retry after the automatic budget. Immutable command and operation ID survive. */
  retryTransientOperation(userId: string, operationId: string, now: number): Promise<PendingOperation> {
    if (!Number.isSafeInteger(now) || now < 0) return Promise.reject(new DomainError('INVALID_ARGUMENT', 'Instante de reintento inválido.'));
    return this.database.transaction(async db => {
      const row = await db.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE user_id=? AND operation_id=?', userId, operationId);
      if (!row) throw new DomainError('NOT_FOUND', 'No se encuentra la operación.');
      if (row.state !== 'FAILED_PERMANENT' || !['RATE_LIMITED', 'TEMPORARY_UNAVAILABLE'].includes(row.error_code ?? '')) {
        throw new DomainError('INVALID_ARGUMENT', 'Sólo se puede reintentar explícitamente un fallo transitorio agotado.');
      }
      const operation = decodeOperation(row);
      if (row.lane === 'ACK') {
        const alarm = await ackProjection(db, userId, operation.command);
        const code = alarm && obsoleteAckCode(operation.command, alarm);
        if (code) throw new DomainError(code, 'El acuse pertenece a una versión o dispositivo anterior.');
      }
      await db.runAsync("UPDATE outbox SET state='QUEUED',attempts=0,next_attempt_at=?,error_code=NULL,receipt=NULL WHERE user_id=? AND operation_id=?", now, userId, operationId);
      const { errorCode: _error, receipt: _receipt, ...preserved } = operation;
      return { ...preserved, state: 'QUEUED', attempts: 0, nextAttemptAt: now };
    });
  }

  alarms(userId: string): Promise<AlarmRecord[]> {
    return this.database.read(async db => (await db.getAllAsync<JsonRow>('SELECT body FROM projections WHERE user_id=? ORDER BY group_id,request_id,recipient_uid', userId)).map(row => JSON.parse(row.body) as AlarmRecord));
  }
  barriers(userId: string): Promise<CancellationBarrier[]> {
    return this.database.read(async db => (await db.getAllAsync<JsonRow>('SELECT body FROM cancellation_barriers WHERE user_id=?', userId)).map(row => JSON.parse(row.body) as CancellationBarrier));
  }
  schedules(userId: string): Promise<LocalSchedule[]> {
    return this.database.read(async db => (await db.getAllAsync<JsonRow>('SELECT body FROM local_schedules WHERE user_id=?', userId)).map(row => JSON.parse(row.body) as LocalSchedule));
  }
  syncState(userId: string): Promise<{ cursor: string | null; syncedAt: number | null; runtimeRevision: number }> {
    return this.database.read(async db => {
      const row = await db.getFirstAsync<{ cursor: string | null; synced_at: number | null; runtime_revision: number }>('SELECT * FROM sync_state WHERE user_id=?', userId);
      return { cursor: row?.cursor ?? null, syncedAt: row?.synced_at ?? null, runtimeRevision: row?.runtime_revision ?? -1 };
    });
  }

  /** Cursor, events, revocations and projections commit together; duplicates cannot advance versions. */
  applyPage(userId: string, page: SyncPage): Promise<void> {
    return this.database.transaction(async db => {
      for (const event of page.events) {
        const inserted = await db.runAsync('INSERT OR IGNORE INTO received_events VALUES(?,?)', userId, event.eventId);
        if (!inserted.changes) continue;
        if (event.kind === 'revoke') {
          await db.runAsync('INSERT OR IGNORE INTO revoked_scopes VALUES(?,?,?)', userId, event.groupId, event.requestId ?? '');
          const suffix = event.requestId ? ' AND request_id=?' : '';
          const args = event.requestId ? [userId, event.groupId, event.requestId] : [userId, event.groupId];
          await db.runAsync(`DELETE FROM projections WHERE user_id=? AND group_id=?${suffix}`, ...args);
          await db.runAsync(`UPDATE outbox SET state='FAILED_PERMANENT',error_code='FORBIDDEN'
            WHERE user_id=? AND group_id=?${suffix} AND state IN ('QUEUED','SENDING')`, ...args);
          // Minimal local specs stay until cancellation is confirmed; no private widget survives.
          await db.runAsync('DELETE FROM widget_snapshots WHERE user_id=?', userId);
          continue;
        }
        let alarm = event.alarm;
        if (await db.getFirstAsync('SELECT 1 FROM revoked_scopes WHERE user_id=? AND group_id=? AND request_id IN (?,\'\')', userId, alarm.groupId, alarm.requestId)) continue;
        const previous = await db.getFirstAsync<JsonRow>('SELECT body FROM projections WHERE user_id=? AND group_id=? AND request_id=? AND recipient_uid=?', userId, alarm.groupId, alarm.requestId, alarm.recipient.uid);
        if (previous) {
          const old = JSON.parse(previous.body) as AlarmRecord;
          // These counters have independent meanings: none may go backwards.
          if (alarm.request.requestVersion < old.request.requestVersion
            || alarm.recipient.decisionRevision < old.recipient.decisionRevision
            || (alarm.primaryDevice && old.primaryDevice && alarm.primaryDevice.deviceEpoch < old.primaryDevice.deviceEpoch)
            || alarm.request.updatedAtEpochMs < old.request.updatedAtEpochMs
            || alarm.recipient.updatedAtEpochMs < old.recipient.updatedAtEpochMs) continue;
          // An out-of-order ACK cannot turn a confirmed cancellation back into SCHEDULED.
          const previousSchedules = new Map(old.schedules.map(schedule =>
            [`${schedule.occurrenceId}/${schedule.deviceId}/${schedule.deviceEpoch}`, schedule]));
          // Each projection carries a complete authorized snapshot. Missing identities
          // (for example a former primary device) must disappear from the projection.
          const schedules = alarm.schedules.map(schedule => {
            const key = `${schedule.occurrenceId}/${schedule.deviceId}/${schedule.deviceEpoch}`;
            const previous = previousSchedules.get(key);
            if (!previous) return schedule;
            if (schedule.requestVersion < previous.requestVersion
              || schedule.decisionRevision < previous.decisionRevision) return previous;
            const newerRevision = schedule.requestVersion > previous.requestVersion
              || schedule.decisionRevision > previous.decisionRevision;
            // A new consent supersedes the old schedule even if the device clock moved backwards.
            if (newerRevision) return schedule;
            if (['CANCELLED', 'EXPIRED', 'FIRED'].includes(previous.status)
              && schedule.status !== previous.status) return previous;
            return schedule.statusUpdatedAtEpochMs > previous.statusUpdatedAtEpochMs ? schedule : previous;
          });
          alarm = { ...alarm, schedules };
        }
        if (alarm.recipient.uid === userId) {
          const pendingAcks = await db.getAllAsync<OutboxRow>(`SELECT * FROM outbox WHERE user_id=? AND group_id=? AND request_id=?
            AND lane='ACK' AND state IN ('QUEUED','SENDING')`, userId, alarm.groupId, alarm.requestId);
          for (const row of pendingAcks) {
            const code = obsoleteAckCode(decodeOperation(row).command, alarm);
            if (code) await db.runAsync(`UPDATE outbox SET state='FAILED_PERMANENT',error_code=?
              WHERE user_id=? AND operation_id=? AND state IN ('QUEUED','SENDING')`, code, userId, row.operation_id);
          }
        }
        await db.runAsync(`INSERT INTO projections VALUES(?,?,?,?,?) ON CONFLICT(user_id,group_id,request_id,recipient_uid)
          DO UPDATE SET body=excluded.body`, userId, alarm.groupId, alarm.requestId, alarm.recipient.uid, JSON.stringify(alarm));
      }
      await db.runAsync(`INSERT INTO sync_state(user_id,cursor,synced_at) VALUES(?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET cursor=excluded.cursor,synced_at=excluded.synced_at`, userId, page.nextCursor, page.serverTimeEpochMs);
    });
  }

  releaseBarrier(userId: string, alarm: AlarmRecord): Promise<void> {
    return this.database.transaction(async db => {
      if (alarm.recipient.uid !== userId || alarm.recipient.decision !== 'ACCEPTED'
        || alarm.recipient.acceptedRequestVersion !== alarm.request.requestVersion) return;
      const row = await db.getFirstAsync<JsonRow>('SELECT body FROM cancellation_barriers WHERE user_id=? AND group_id=? AND request_id=?', userId, alarm.groupId, alarm.requestId);
      if (!row) return;
      const barrier = JSON.parse(row.body) as CancellationBarrier;
      const operations = await db.getAllAsync<OutboxRow>(`SELECT * FROM outbox WHERE user_id=? AND group_id=? AND request_id=?
        AND state='CONFIRMED' AND kind='respondToAlarm'
        AND sequence>(SELECT sequence FROM outbox WHERE user_id=? AND operation_id=?)`, userId, alarm.groupId, alarm.requestId, userId, barrier.operationId);
      const accepted = operations.some(row => {
        const operation = decodeOperation(row);
        const command = operation.command as RespondToAlarm;
        return command.payload.decision === 'ACCEPTED' && operation.receipt?.requestVersion === alarm.request.requestVersion
          && operation.receipt.decisionRevision === alarm.recipient.decisionRevision
          && alarm.recipient.decisionRevision > barrier.decisionRevision;
      });
      if (accepted) await db.runAsync('DELETE FROM cancellation_barriers WHERE user_id=? AND group_id=? AND request_id=?', userId, alarm.groupId, alarm.requestId);
    });
  }

  saveSchedule(userId: string, schedule: LocalSchedule, ack?: AlarmCommand): Promise<void> {
    return this.database.transaction(async db => {
      if (ack) await insertOperation(db, userId, 'reportSchedule', ack, schedule.updatedAt, 'ACK');
      await db.runAsync(`INSERT INTO local_schedules VALUES(?,?,?,?,?) ON CONFLICT(user_id,occurrence_key)
        DO UPDATE SET body=excluded.body`, userId, occurrenceKey(schedule.spec), schedule.groupId, schedule.spec.requestId, JSON.stringify(schedule));
    });
  }
  saveRuntimeRevision(userId: string, revision: number): Promise<void> {
    return this.database.transaction(async db => {
      await db.runAsync(`INSERT INTO sync_state(user_id,runtime_revision) VALUES(?,?) ON CONFLICT(user_id)
        DO UPDATE SET runtime_revision=MAX(runtime_revision,excluded.runtime_revision)`, userId, revision);
    });
  }
  saveWidget(userId: string, snapshot: unknown): Promise<void> {
    return this.database.transaction(async db => { await db.runAsync('INSERT OR REPLACE INTO widget_snapshots VALUES(?,?)', userId, JSON.stringify(snapshot)); });
  }
  readWidget<T>(userId: string): Promise<T | null> {
    return this.database.read(async db => {
      const row = await db.getFirstAsync<JsonRow>('SELECT body FROM widget_snapshots WHERE user_id=?', userId);
      return row ? JSON.parse(row.body) as T : null;
    });
  }
  beginCleanup(userId: string): Promise<void> {
    return this.database.transaction(async db => {
      await db.runAsync('INSERT OR IGNORE INTO cleanup_pending VALUES(?)', userId);
      await db.runAsync('DELETE FROM widget_snapshots WHERE user_id=?', userId);
    });
  }
  pendingCleanup(): Promise<string[]> {
    return this.database.read(async db => (await db.getAllAsync<{ user_id: string }>('SELECT user_id FROM cleanup_pending')).map(row => row.user_id));
  }
  clearUser(userId: string, preserveAccount = false): Promise<void> {
    return this.database.transaction(async db => {
      for (const table of ['projections','outbox','local_schedules','cancellation_barriers','sync_state','received_events','revoked_scopes','widget_snapshots','cleanup_pending']) {
        if (preserveAccount && table === 'cleanup_pending') continue;
        await db.runAsync(`DELETE FROM ${table} WHERE user_id=?`, userId);
      }
      if (!preserveAccount) await db.runAsync('DELETE FROM account_owner WHERE singleton=1 AND user_id=?', userId);
    });
  }
}
