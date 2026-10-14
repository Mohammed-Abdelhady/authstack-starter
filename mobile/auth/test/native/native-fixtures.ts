import { apiReply } from '../support/support';

export const ATTEMPT_ID = 'attempt-1';
export const ATTEMPT_SECRET = 's'.repeat(43);
export const NONCE_DIGEST = 'a'.repeat(64);
export const TEMPORARY_PASSWORD = ['temporary', 'secret'].join('-');
export const NEW_PASSWORD = ['new', 'secret'].join('-');

export function startReply(expiresAt: string) {
  return apiReply({
    attemptId: ATTEMPT_ID,
    attemptSecret: ATTEMPT_SECRET,
    providerNonceDigest: NONCE_DIGEST,
    stage: 'firstFactorRequired',
    expiresAt,
    factors: ['password', 'provider', 'passkey', 'emailLink'],
  });
}

export function secondFactorReply(expiresAt: string) {
  return apiReply({
    attemptId: ATTEMPT_ID,
    stage: 'secondFactorRequired',
    expiresAt,
    factors: ['totp'],
  });
}
