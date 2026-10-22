import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCanRespond,
  decisionAfterVersionBump,
  hasCurrentConsent,
  isConsentStale,
  isDecisionTransitionAllowed,
  mustCancelLocal,
  nextDecisionRevision,
  type RespondAuthorizationInput,
} from '../src/domain/index.ts';
import { expectDomainError } from './helpers.ts';

const base: RespondAuthorizationInput = {
  actorUid: 'ana',
  creatorUid: 'luis',
  recipientUid: 'ana',
  memberActive: true,
  proposalStatus: 'ACTIVE',
  expectedRequestVersion: 2,
  currentRequestVersion: 2,
  expectedDecisionRevision: 1,
  currentDecisionRevision: 1,
  from: 'PENDING',
  to: 'ACCEPTED',
};

test('el consentimiento solo vale para la versión vigente', () => {
  assert.equal(hasCurrentConsent({ decision: 'ACCEPTED', acceptedRequestVersion: 2, requestVersion: 2 }), true);
  assert.equal(hasCurrentConsent({ decision: 'ACCEPTED', acceptedRequestVersion: 1, requestVersion: 2 }), false);
  assert.equal(hasCurrentConsent({ decision: 'REJECTED', acceptedRequestVersion: 2, requestVersion: 2 }), false);
  assert.equal(hasCurrentConsent({ decision: 'ACCEPTED', requestVersion: 2 }), false);
  assert.equal(isConsentStale({ decision: 'ACCEPTED', acceptedRequestVersion: 1, requestVersion: 2 }), true);
  assert.equal(isConsentStale({ decision: 'REJECTED', acceptedRequestVersion: 1, requestVersion: 2 }), false);
});

test('un cambio de términos exige volver a aceptar', () => {
  assert.equal(decisionAfterVersionBump('ACCEPTED', 1, 2), 'NEEDS_REVIEW');
  assert.equal(decisionAfterVersionBump('ACCEPTED', 2, 2), 'ACCEPTED');
  assert.equal(decisionAfterVersionBump('REJECTED', undefined, 3), 'REJECTED');
});

test('solo el destinatario puede responder y con las versiones vigentes', () => {
  assert.doesNotThrow(() => assertCanRespond(base));
  assert.doesNotThrow(() => assertCanRespond({ ...base, actorUid: 'luis', recipientUid: 'luis' }));

  expectDomainError(() => assertCanRespond({ ...base, actorUid: '' }), 'UNAUTHENTICATED');
  expectDomainError(() => assertCanRespond({ ...base, memberActive: false }), 'FORBIDDEN');
  expectDomainError(() => assertCanRespond({ ...base, actorUid: 'luis', recipientUid: 'ana' }), 'FORBIDDEN');
  expectDomainError(() => assertCanRespond({ ...base, actorUid: 'carla', recipientUid: 'ana' }), 'FORBIDDEN');
  expectDomainError(
    () => assertCanRespond({ ...base, proposalStatus: 'WITHDRAWN' }),
    'EXPIRED',
  );
  expectDomainError(
    () => assertCanRespond({ ...base, expectedRequestVersion: 1, currentRequestVersion: 2 }),
    'VERSION_CONFLICT',
  );
  expectDomainError(
    () => assertCanRespond({ ...base, expectedDecisionRevision: 0, currentDecisionRevision: 1 }),
    'VERSION_CONFLICT',
  );
});

test('las transiciones de decisión no retroceden a estados imposibles', () => {
  assert.equal(isDecisionTransitionAllowed('PENDING', 'ACCEPTED'), true);
  assert.equal(isDecisionTransitionAllowed('PENDING', 'DISABLED'), false);
  assert.equal(isDecisionTransitionAllowed('ACCEPTED', 'DISABLED'), true);
  assert.equal(isDecisionTransitionAllowed('ACCEPTED', 'NEEDS_REVIEW'), true);
  assert.equal(isDecisionTransitionAllowed('REJECTED', 'ACCEPTED'), true);
  assert.equal(isDecisionTransitionAllowed('NEEDS_REVIEW', 'PENDING'), false);
  expectDomainError(
    () => assertCanRespond({ ...base, from: 'PENDING', to: 'DISABLED' as never }),
    'INVALID_ARGUMENT',
  );
});

test('rechazar o desactivar cancela lo local; aceptar no', () => {
  assert.equal(mustCancelLocal('REJECTED'), true);
  assert.equal(mustCancelLocal('DISABLED'), true);
  assert.equal(mustCancelLocal('NEEDS_REVIEW'), true);
  assert.equal(mustCancelLocal('ACCEPTED'), false);
  assert.equal(mustCancelLocal('PENDING'), false);
});

test('la revisión de decisión siempre avanza', () => {
  assert.equal(nextDecisionRevision(1), 2);
  expectDomainError(() => nextDecisionRevision(-1), 'INVALID_ARGUMENT');
  expectDomainError(() => nextDecisionRevision(1.5), 'INVALID_ARGUMENT');
});
