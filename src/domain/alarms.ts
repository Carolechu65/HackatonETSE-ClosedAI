/**
 * Proyección para la UI; no sustituye los estados/versiones del contrato remoto.
 * `scheduledAt` sigue siendo ISO 8601 para no romper la bandeja de demostración;
 * el transporte entre dispositivos usa `TimeSpec` con epoch ms y zona IANA.
 */
import { summarizeScheduling, type Decision, type SchedulingStatus } from './states.ts';

export type AlarmSummary = {
  id: string;
  title: string;
  proposedBy: string;
  scheduledAt: string | null;
  decision: 'pending' | 'accepted' | 'rejected' | 'disabled';
  scheduling: 'not_scheduled' | 'pending_activation' | 'scheduled';
};

/** `NEEDS_REVIEW` exige una acción del usuario: se muestra como pendiente, no como aceptada. */
export function decisionToSummary(decision: Decision): AlarmSummary['decision'] {
  switch (decision) {
    case 'ACCEPTED':
      return 'accepted';
    case 'REJECTED':
      return 'rejected';
    case 'DISABLED':
      return 'disabled';
    default:
      return 'pending';
  }
}

export function schedulingToSummary(status: SchedulingStatus): AlarmSummary['scheduling'] {
  return summarizeScheduling(status);
}

export interface Clock {
  nowEpochMs(): number;
}

export const systemClock: Clock = { nowEpochMs: () => Date.now() };
