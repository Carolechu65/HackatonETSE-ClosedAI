import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { parseOperation } from '../contracts/operation';

function pendingOperation(name: string) {
  return onCall<unknown>((request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.');
    }
    parseOperation(request.data);
    // P3: validar payload específico, pertenencia y destinatario/dispositivo.
    // Después: transacción con versiones, idempotencia y evento para FCM.
    // No devolver éxito antes de persistir; Admin SDK no queda limitado por Rules.
    throw new HttpsError('unimplemented', `${name}: operación pendiente de implementación.`);
  });
}

export const createAlarmRequest = pendingOperation('createAlarmRequest');
export const respondToAlarm = pendingOperation('respondToAlarm');
export const reportSchedule = pendingOperation('reportSchedule');
