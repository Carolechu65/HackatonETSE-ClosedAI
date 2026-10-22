/**
 * Ejes de estado del contrato v1 (TDD §4).
 *
 * No existe un único enum que mezcle red, consentimiento y sistema operativo:
 * una propuesta aceptada (`ACCEPTED`) no demuestra que esté programada
 * (`SCHEDULED`), y un acuse de programación no demuestra que sonara el aviso.
 */

export const PROPOSAL_STATUSES = ['ACTIVE', 'WITHDRAWN', 'EXPIRED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const RECEPTION_STATUSES = ['NOT_ACKNOWLEDGED', 'RECEIVED'] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

export const DECISIONS = ['PENDING', 'ACCEPTED', 'REJECTED', 'DISABLED', 'NEEDS_REVIEW'] as const;
export type Decision = (typeof DECISIONS)[number];

export const SCHEDULING_STATUSES = [
  'NOT_SCHEDULED',
  'PENDING_PERMISSION',
  'SCHEDULING',
  'SCHEDULED',
  'CANCEL_PENDING',
  'CANCELLED',
  'FIRED',
  'FAILED',
  'EXPIRED',
] as const;
export type SchedulingStatus = (typeof SCHEDULING_STATUSES)[number];

/** Estados que un dispositivo puede declarar en un acuse (no incluye NOT_SCHEDULED). */
export const SCHEDULE_REPORT_STATUSES = [
  'PENDING_PERMISSION',
  'SCHEDULING',
  'SCHEDULED',
  'CANCEL_PENDING',
  'CANCELLED',
  'FIRED',
  'FAILED',
  'EXPIRED',
] as const satisfies readonly SchedulingStatus[];
export type ScheduleReportStatus = (typeof SCHEDULE_REPORT_STATUSES)[number];

export const SYNC_STATUSES = ['QUEUED', 'SENDING', 'CONFIRMED', 'CONFLICT', 'FAILED_PERMANENT'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const MODES = ['ALARM', 'NOTIFICATION'] as const;
export type Mode = (typeof MODES)[number];

export const CONSENT_SCOPES = ['THIS_OCCURRENCE', 'SERIES'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** Mecanismo local que materializa una ocurrencia. Una misma ocurrencia usa uno solo. */
export const SCHEDULE_MECHANISMS = ['ALARM_RUNTIME', 'EXPO_NOTIFICATIONS'] as const;
export type ScheduleMechanism = (typeof SCHEDULE_MECHANISMS)[number];

/** Los cinco ejes de una propuesta vista por un destinatario concreto. */
export type AlarmAxes = {
  proposal: ProposalStatus;
  reception: ReceptionStatus;
  decision: Decision;
  scheduling: SchedulingStatus;
  sync: SyncStatus;
};

/** Resumen para la UI: nunca presenta como programado algo que solo está aceptado. */
export type SchedulingSummary = 'not_scheduled' | 'pending_activation' | 'scheduled';

export function summarizeScheduling(status: SchedulingStatus): SchedulingSummary {
  switch (status) {
    case 'SCHEDULED':
    case 'FIRED':
    case 'CANCEL_PENDING':
      return 'scheduled';
    case 'SCHEDULING':
    case 'PENDING_PERMISSION':
      return 'pending_activation';
    default:
      return 'not_scheduled';
  }
}

/** Estados en los que la app debe ofrecer una acción concreta al usuario. */
export function requiresUserAction(status: SchedulingStatus): boolean {
  return status === 'PENDING_PERMISSION' || status === 'FAILED' || status === 'CANCEL_PENDING';
}

const DECISION_TRANSITIONS: Readonly<Record<Decision, readonly Decision[]>> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['ACCEPTED', 'DISABLED', 'NEEDS_REVIEW'],
  REJECTED: ['ACCEPTED', 'REJECTED', 'NEEDS_REVIEW'],
  DISABLED: ['ACCEPTED', 'NEEDS_REVIEW'],
  NEEDS_REVIEW: ['ACCEPTED', 'REJECTED', 'DISABLED'],
};

/** `false` si la decisión nueva exige volver a cargar el documento o no es posible. */
export function isDecisionTransitionAllowed(from: Decision, to: Decision): boolean {
  return DECISION_TRANSITIONS[from].includes(to);
}

export function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

export function isConsentScope(value: unknown): value is ConsentScope {
  return typeof value === 'string' && (CONSENT_SCOPES as readonly string[]).includes(value);
}

export function isScheduleReportStatus(value: unknown): value is ScheduleReportStatus {
  return typeof value === 'string' && (SCHEDULE_REPORT_STATUSES as readonly string[]).includes(value);
}

export function isScheduleMechanism(value: unknown): value is ScheduleMechanism {
  return typeof value === 'string' && (SCHEDULE_MECHANISMS as readonly string[]).includes(value);
}
