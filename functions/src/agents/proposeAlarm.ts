import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { parseOperation } from '../contracts/operation';

/** Salida propuesta: una intención nunca es consentimiento del destinatario. */
export type AlarmProposal =
  | { status: 'needs_clarification'; question: string; missingFields: string[] }
  | {
      status: 'draft';
      title: string;
      recipientUids: string[];
      scheduledAtEpochMs: number;
      timeZone: string;
      mode: 'ALARM' | 'NOTIFICATION';
      reason: string;
      requiresSenderReview: true;
      requiresRecipientConsent: true;
    };

export const proposeAlarm = onCall<unknown>((request): AlarmProposal => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.');
  }
  const command = parseOperation(request.data);
  const text = command.payload.text;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 2000) {
    throw new HttpsError('invalid-argument', 'payload.text debe contener entre 1 y 2000 caracteres.');
  }
  // P3 + P2: contexto autorizado → planner → validación determinista → revisión.
  // Herramientas permitidas: leer disponibilidad autorizada y proponer borradores.
  // No habilitar escritura directa, aceptación ni programación desde el agente.
  throw new HttpsError('unimplemented', 'Pendiente conectar planner y validación del borrador.');
});
