import type { AlarmRequestDocument, RecipientDocument, RespondToAlarm, ReportSchedule } from '../../../src/domain/contracts/types.ts';
import type { AlarmRecord, LocalSchedule, SyncPage } from '../../../src/data/model.ts';
import { readContractsFile } from '../../helpers.ts';

export function response(operationId = 'accept', decision: 'ACCEPTED' | 'DISABLED' | 'REJECTED' = 'ACCEPTED'): RespondToAlarm {
  const command = readContractsFile<RespondToAlarm>('fixtures/operations/respond-to-alarm.accept.json');
  return { ...command, operationId, payload: decision === 'ACCEPTED' ? { decision, consentScope: 'THIS_OCCURRENCE' } : { decision } };
}
export function alarm(): AlarmRecord {
  return { groupId: 'piso-demo', requestId: 'req-001',
    request: readContractsFile<AlarmRequestDocument>('fixtures/documents/alarm-request.active.json'),
    recipient: readContractsFile<RecipientDocument>('fixtures/documents/recipient.accepted.json'),
    primaryDevice: { deviceId: 'dev-a1', deviceEpoch: 1 }, schedules: [] };
}
export function page(record = alarm(), eventId = 'event-1', nextCursor = 'cursor-1'): SyncPage {
  return { events: [{ kind: 'upsert', eventId, alarm: record }], nextCursor, hasMore: false, serverTimeEpochMs: 1000 };
}
export function scheduleAndAck(): { schedule: LocalSchedule; ack: ReportSchedule } {
  const ack = readContractsFile<ReportSchedule>('fixtures/operations/report-schedule.scheduled.json');
  return { ack, schedule: { groupId: ack.groupId, status: 'SCHEDULED', updatedAt: 1000,
    spec: { userId: 'ana', requestId: ack.entityId!, occurrenceId: ack.payload.occurrenceId,
      deviceId: ack.payload.deviceId, deviceEpoch: ack.payload.deviceEpoch,
      requestVersion: ack.payload.requestVersion, decisionRevision: ack.payload.decisionRevision,
      effectiveAtEpochMs: ack.payload.effectiveAtEpochMs, timeZone: 'Europe/Madrid', title: 'Sacar la basura', mode: ack.payload.mode } } };
}
