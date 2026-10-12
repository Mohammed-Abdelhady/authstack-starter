import { FrozenClock } from '../../../../test/utils/frozen-clock';
import { IdFormat } from '../../../common/persistence/id-format';
import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { LinkedAccountStore } from '../../../user/stores/linked-account.store'; // feature:oauth-core
import { SignInMethodStore } from '../../../user/stores/sign-in-method.store';
import { PasskeyChallengePurpose } from '../constants/passkeys.constants';
import { PasskeyAccounts } from '../stores/passkey-accounts';
import { PasskeyChallengeStore } from '../stores/passkey-challenge.store';
import { PasskeyStore } from '../stores/passkey.store';

export interface StoredPasskeyFacts {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
  name: string;
  lastUsedAt: Date | null;
}

export interface SeedPasskey {
  userId: string;
  credentialId: string;
  createdAt: Date;
  counter?: number;
  name?: string;
}

export interface StoredPasskeyChallengeFacts {
  challengeHash: string;
  purpose: string;
  userId: string | null;
  expiresAt: Date;
}

export interface SeedPasskeyChallenge {
  challengeHash: string;
  purpose: PasskeyChallengePurpose;
  expiresAt: Date;
}

/**
 * What one database gives the shared passkey cases: the adapters under test,
 * and plain reads and writes of stored state that go around them.
 */
export interface PasskeysContractHarness {
  readonly clock: FrozenClock;
  readonly passkeys: PasskeyStore;
  readonly challenges: PasskeyChallengeStore;
  readonly accounts: PasskeyAccounts;
  readonly links: LinkedAccountStore; // feature:oauth-core
  readonly signInMethods: SignInMethodStore;
  /** The adapter's runner, pausing before a rerun the way the case says. */
  runner(pause: RerunPause): UnitOfWorkRunner;

  /** How many passkeys the account's own profile read counts. */
  profilePasskeyCount(userId: string): Promise<number>;

  seedAccount(account: {
    email: string;
    passwordHash?: string;
    /** A provider account linked to it. */
    linked?: boolean;
  }): Promise<string>;
  setDeleted(userId: string, deleted: boolean): Promise<void>;
  removeAccount(userId: string): Promise<void>;
  /** The providers linked to an account, as stored. */
  storedProviders(userId: string): Promise<string[]>;

  seedPasskey(passkey: SeedPasskey): Promise<string>;
  /** Every stored passkey, by credential id. */
  storedPasskeys(): Promise<StoredPasskeyFacts[]>;

  seedChallenge(challenge: SeedPasskeyChallenge): Promise<void>;
  /** Changes when a stored challenge lapses, committed, around the adapters. */
  setChallengeExpiry(challengeHash: string, expiresAt: Date): Promise<void>;
  /** Every stored challenge, by hash. */
  storedChallenges(): Promise<StoredPasskeyChallengeFacts[]>;

  /** What this database takes as an id, as a route asks it. */
  readonly ids: IdFormat;
  /** A well-formed id that names nothing. */
  absentId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignId(): string;

  reset(): Promise<void>;
  close(): Promise<void>;
}

export type PasskeysHarnessSource = () => PasskeysContractHarness;

/** Orders stored passkeys the same way on every database. */
export function byCredentialId(
  left: { credentialId: string },
  right: { credentialId: string },
): number {
  if (left.credentialId === right.credentialId) return 0;
  return left.credentialId < right.credentialId ? -1 : 1;
}
