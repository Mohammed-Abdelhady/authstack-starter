import { PasskeyChallengePurpose } from '../constants/passkeys.constants';

/** Shared names of the unique rules a challenge can run into. */
export const PASSKEY_CHALLENGE_CONSTRAINT = {
  CHALLENGE: 'passkey_challenge.challenge_hash',
} as const;

export const CHALLENGE_USE = {
  CONSUMED: 'consumed',
  REFUSED: 'refused',
} as const;

/**
 * How spending a challenge ended: this call spent it, or it was unknown,
 * spent before, issued for the other ceremony, or past its expiry.
 */
export type ChallengeUse = (typeof CHALLENGE_USE)[keyof typeof CHALLENGE_USE];

export interface NewPasskeyChallenge {
  /** sha256 of the WebAuthn challenge, hex encoded. */
  challengeHash: string;
  purpose: PasskeyChallengePurpose;
  /**
   * Account a registration challenge was issued to. An id this database could
   * not have issued is left off rather than refused.
   */
  userId?: string;
  expiresAt: Date;
}

export interface PasskeyChallengeKey {
  challengeHash: string;
  purpose: PasskeyChallengePurpose;
}

/**
 * The WebAuthn challenges handed out and not yet answered. Expiry is compared
 * by the caller's clock on every use: a row that outlived its expiry is
 * refused, whether or not anything removed it.
 */
export abstract class PasskeyChallengeStore {
  /** A challenge that is already stored is a `UniqueConflictError`. */
  abstract open(challenge: NewPasskeyChallenge): Promise<void>;
  /**
   * Spends the challenge. A challenge whose expiry is at or before `now` is
   * refused. Of two requests that arrive together, one spends it.
   */
  abstract consume(key: PasskeyChallengeKey, now: Date): Promise<ChallengeUse>;
}
