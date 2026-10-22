import type { AlarmCommand } from './types.ts';
import type { OperationName } from './validate.ts';

/**
 * Discrimina el comando por la forma de su payload validado.
 * El servidor conoce la operación por la callable invocada; esto sirve para
 * repositorios, outbox y tests que reciben comandos ya parseados.
 */
export function operationNameOf(command: AlarmCommand): OperationName {
  const payload = command.payload as Record<string, unknown>;
  if ('recipientUids' in payload) return 'createAlarmRequest';
  if ('decision' in payload) return 'respondToAlarm';
  if ('occurrenceId' in payload) return 'reportSchedule';
  return 'withdrawAlarmRequest';
}
