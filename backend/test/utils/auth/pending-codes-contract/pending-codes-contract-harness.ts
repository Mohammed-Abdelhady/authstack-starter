import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../../src/common/persistence/unit-of-work';
import {
  MailCounterPurpose,
  PendingPurpose,
} from '../../../../src/auth/constants/registration';
import { MailCounterStore } from '../../../../src/auth/pending-codes/mail-counter.store';
import { PasswordResetCodeStore } from '../../../../src/auth/pending-codes/password-reset-code.store';
import { PendingRegistrationStore } from '../../../../src/auth/pending-codes/pending-registration.store';
import { FrozenClock } from '../../frozen-clock';

export interface StoredCounter {
  email: string;
  purpose: MailCounterPurpose;
  mailedCodes: number;
  windowStartedAt: Date;
  expiresAt: Date;
}

export interface SeedRegistration {
  email: string;
  purpose: PendingPurpose;
  hashedCode: string;
  attempts: number;
  expiresAt: Date;
  userId?: string;
  addressGeneration?: number;
}

export interface StoredRegistration {
  id: string;
  email: string;
  purpose: PendingPurpose;
  hashedCode: string;
  attempts: number;
  expiresAt: Date;
  userId: string | null;
  addressGeneration: number | null;
}

export interface SeedPasswordReset {
  email: string;
  hashedCode: string;
  attempts: number;
  expiresAt: Date;
}

export interface StoredPasswordReset extends SeedPasswordReset {
  id: string;
}

export interface PendingCodeStores {
  mailCounters: MailCounterStore;
  registrations: PendingRegistrationStore;
  passwordResets: PasswordResetCodeStore;
}

/**
 * What one database gives the shared contract cases: the adapters under test,
 * its unit of work runner, and plain reads and writes of stored rows that go
 * around the adapters so a case can check what was really stored.
 */
export interface PendingCodesContractHarness {
  readonly clock: FrozenClock;
  readonly stores: PendingCodeStores;
  runner(pause: RerunPause): UnitOfWorkRunner;

  seedCounter(counter: StoredCounter): Promise<void>;
  counter(
    email: string,
    purpose: MailCounterPurpose,
  ): Promise<StoredCounter | null>;
  counterCount(): Promise<number>;

  seedRegistration(record: SeedRegistration): Promise<string>;
  /** Looked up by the stored form of the address. */
  registration(
    email: string,
    purpose: PendingPurpose,
  ): Promise<StoredRegistration | null>;
  registrationCount(): Promise<number>;

  seedPasswordReset(record: SeedPasswordReset): Promise<string>;
  passwordReset(email: string): Promise<StoredPasswordReset | null>;
  passwordResetCount(): Promise<number>;

  /** A well-formed id, as an account of this database would have. */
  accountId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignId(): string;

  reset(): Promise<void>;
  close(): Promise<void>;
}
