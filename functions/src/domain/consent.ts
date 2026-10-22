/** Regla pura inicial. No sustituye autorización, transacción ni idempotencia. */
export function hasCurrentConsent(input: {
  decision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'DISABLED' | 'NEEDS_REVIEW';
  requestVersion: number;
  acceptedRequestVersion: number;
}): boolean {
  return input.decision === 'ACCEPTED' &&
    Number.isSafeInteger(input.requestVersion) &&
    input.requestVersion > 0 &&
    input.requestVersion === input.acceptedRequestVersion;
}
