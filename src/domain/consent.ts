/**
 * Reglas puras de consentimiento (TDD §3 y §4).
 *
 * Solo el destinatario decide. Una propuesta aceptada vale para
 * `(requestVersion, decisionRevision)`; si el emisor cambia los términos,
 * el consentimiento deja de ser vigente hasta una nueva aceptación.
 */
import { DomainError } from './errors.ts';
import {
  isDecisionTransitionAllowed,
  type Decision,
  type ProposalStatus,
} from './states.ts';

export type ConsentSnapshot = {
  decision: Decision;
  /** Versión de propuesta que el destinatario aceptó. Ausente si nunca aceptó. */
  acceptedRequestVersion?: number;
  /** Versión vigente de la propuesta en el servidor. */
  requestVersion: number;
};

/** `true` solo si la decisión aceptada corresponde a la versión vigente. */
export function hasCurrentConsent(snapshot: ConsentSnapshot): boolean {
  return snapshot.decision === 'ACCEPTED'
    && Number.isSafeInteger(snapshot.requestVersion)
    && snapshot.requestVersion > 0
    && snapshot.acceptedRequestVersion === snapshot.requestVersion;
}

/** Un cambio de términos invalida el consentimiento anterior. */
export function isConsentStale(snapshot: ConsentSnapshot): boolean {
  if (snapshot.decision !== 'ACCEPTED') return false;
  if (snapshot.acceptedRequestVersion === undefined) return true;
  return snapshot.acceptedRequestVersion < snapshot.requestVersion;
}

/** Decisión resultante tras publicar una versión nueva de la propuesta. */
export function decisionAfterVersionBump(
  decision: Decision,
  acceptedRequestVersion: number | undefined,
  newRequestVersion: number,
): Decision {
  if (decision === 'ACCEPTED' && (acceptedRequestVersion === undefined || acceptedRequestVersion < newRequestVersion)) {
    return 'NEEDS_REVIEW';
  }
  return decision;
}

/** La cancelación local va primero: una proyección remota antigua no la reactiva. */
export function mustCancelLocal(decision: Decision): boolean {
  return decision === 'REJECTED' || decision === 'DISABLED' || decision === 'NEEDS_REVIEW';
}

export type RespondAuthorizationInput = {
  actorUid: string;
  creatorUid: string;
  recipientUid: string;
  memberActive: boolean;
  proposalStatus: ProposalStatus;
  expectedRequestVersion: number;
  currentRequestVersion: number;
  expectedDecisionRevision: number;
  currentDecisionRevision: number;
  from: Decision;
  to: Decision;
};

/**
 * Autorización de `respondToAlarm` antes de escribir nada.
 * Lanza `DomainError` con el código del contrato (no revela datos ajenos).
 */
export function assertCanRespond(input: RespondAuthorizationInput): void {
  if (!input.actorUid) {
    throw new DomainError('UNAUTHENTICATED', 'Inicia sesión para responder.');
  }
  if (!input.memberActive) {
    throw new DomainError('FORBIDDEN', 'No perteneces a este piso.');
  }
  if (input.actorUid !== input.recipientUid) {
    throw new DomainError('FORBIDDEN', 'Solo el destinatario decide sobre su aviso.');
  }
  if (input.proposalStatus !== 'ACTIVE') {
    throw new DomainError('EXPIRED', 'La propuesta ya no admite respuestas.');
  }
  if (input.expectedRequestVersion !== input.currentRequestVersion) {
    throw new DomainError('VERSION_CONFLICT', 'La propuesta cambió: vuelve a cargarla antes de responder.', {
      expectedRequestVersion: input.expectedRequestVersion,
      currentRequestVersion: input.currentRequestVersion,
    });
  }
  if (input.expectedDecisionRevision !== input.currentDecisionRevision) {
    throw new DomainError('VERSION_CONFLICT', 'Tu decisión ya se actualizó en otro dispositivo.', {
      expectedDecisionRevision: input.expectedDecisionRevision,
      currentDecisionRevision: input.currentDecisionRevision,
    });
  }
  if (!isDecisionTransitionAllowed(input.from, input.to)) {
    throw new DomainError('INVALID_ARGUMENT', `No se puede pasar de ${input.from} a ${input.to}.`, {
      from: input.from,
      to: input.to,
    });
  }
}

/** Toda respuesta incrementa la revisión; nunca se retrocede. */
export function nextDecisionRevision(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'Revisión de decisión inválida.', { current });
  }
  return current + 1;
}
