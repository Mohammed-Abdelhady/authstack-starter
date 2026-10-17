import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
/** Shared names of the unique rules a challenge can run into. */
export const SECOND_FACTOR_CHALLENGE_CONSTRAINT = {
  NONCE: 'two_factor_challenge.nonce_hash',
} as const;

export interface NewSecondFactorChallenge {
  userId: string;
  /** sha256 of the nonce inside the cookie, hex encoded. */
  nonceHash: string;
  expiresAt: Date;
}

/** What the cookie proves: the nonce and the account it was issued for. */
export interface SecondFactorChallengeKey {
  nonceHash: string;
  userId: string;
}

export interface StoredSecondFactorChallenge {
  id: string;
  userId: string;
  /** Wrong answers counted so far. */
  attempts: number;
  expiresAt: Date;
}

export interface ChallengeClaimLimits {
  /** A challenge whose expiry is at or before this instant is refused. */
  now: Date;
  /** A challenge with this many wrong answers is refused. */
  maxAttempts: number;
}

/**
 * The half-finished sign-ins waiting for a second factor. Expiry is compared
 * by the caller's clock on every use: a row that outlived its expiry is still
 * refused, whether or not anything removed it.
 */
export abstract class SecondFactorChallengeStore {
  /** Whether this database could have issued the account id. */
  abstract isAccountId(id: string): boolean;

  /** A nonce that is already stored is a `UniqueConflictError`. */
  abstract open(challenge: NewSecondFactorChallenge): Promise<void>;
  abstract openIn(
    work: UnitOfWork,
    challenge: NewSecondFactorChallenge,
  ): Promise<void>;
  /** The stored challenge, whatever its state. */
  abstract find(
    key: SecondFactorChallengeKey,
  ): Promise<StoredSecondFactorChallenge | null>;
  /**
   * Claims the challenge for one request. Null when it is unknown, expired,
   * out of attempts, or held by another request: of two requests that arrive
   * together, one gets it.
   */
  abstract claim(
    key: SecondFactorChallengeKey,
    limits: ChallengeClaimLimits,
  ): Promise<StoredSecondFactorChallenge | null>;
  /**
   * Counts one wrong answer and releases the claim. Answers with the count
   * after this one, or null when the challenge is gone.
   */
  abstract countFailure(
    challengeId: string,
  ): Promise<{ attempts: number } | null>;
  abstract discard(challengeId: string): Promise<void>;
}
