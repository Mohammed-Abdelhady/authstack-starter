import { FrozenClock } from '../../../../test/utils/frozen-clock';
import { StoredTotpSecret } from '../stores/second-factor-account';
import { SecondFactorChallengeStore } from '../stores/second-factor-challenge.store';
import { SecondFactorStore } from '../stores/second-factor.store';

export interface StoredSecondFactorFacts {
  enabled: boolean;
  secret: StoredTotpSecret | null;
  confirmedAt: Date | null;
  /** In the order they were handed out. */
  recoveryCodes: { hash: string; usedAt: Date | null }[];
  lastUsedStep: number | null;
}

/** The wrong answers counted on an account, and the lock they earned. */
export interface StoredFailureFacts {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface StoredChallengeFacts {
  id: string;
  userId: string;
  nonceHash: string;
  attempts: number;
  claimed: boolean;
  expiresAt: Date;
}

export interface SeedChallenge {
  userId: string;
  nonceHash: string;
  expiresAt: Date;
  attempts?: number;
  claimedAt?: Date;
}

/**
 * What one database gives the shared second factor cases: the adapters under
 * test, and plain reads and writes of stored state that go around them.
 */
export interface TwoFactorContractHarness {
  readonly clock: FrozenClock;
  readonly accounts: SecondFactorStore;
  readonly challenges: SecondFactorChallengeStore;

  /** What the account's own profile read says about the factor. */
  profileSaysEnabled(userId: string): Promise<boolean>;

  seedAccount(account: {
    email: string;
    passwordHash?: string;
    deleted?: boolean;
  }): Promise<string>;
  setDeleted(userId: string, deleted: boolean): Promise<void>;
  removeAccount(userId: string): Promise<void>;
  seedSecondFactor(
    userId: string,
    state: StoredSecondFactorFacts,
  ): Promise<void>;
  secondFactor(userId: string): Promise<StoredSecondFactorFacts>;
  /** Stores a count and a lock on an account that already has a state. */
  seedFailures(userId: string, failures: StoredFailureFacts): Promise<void>;
  failures(userId: string): Promise<StoredFailureFacts>;

  seedChallenge(challenge: SeedChallenge): Promise<string>;
  /** Changes stored fields of a challenge, committed, around the adapters. */
  alterChallenge(
    challengeId: string,
    change: { expiresAt?: Date; attempts?: number },
  ): Promise<void>;
  /** Every stored challenge, by nonce hash. */
  storedChallenges(): Promise<StoredChallengeFacts[]>;

  /** A well-formed id that names nothing. */
  absentId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignId(): string;

  reset(): Promise<void>;
  close(): Promise<void>;
}

export type TwoFactorHarnessSource = () => TwoFactorContractHarness;
