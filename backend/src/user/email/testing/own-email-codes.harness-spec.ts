import type { EmailChangePurpose } from '../../../auth/constants/registration';
import { storedAddress } from '../../../common/persistence/stored-address';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  MAIL_RECORD,
  MailCounterKey,
  MailCounterStore,
  MailRecord,
} from '../../../auth/pending-codes/mail-counter.store';
import {
  AttemptRule,
  CODE_CLAIM,
  CODE_ROTATION,
  CodeClaim,
  CodeRotation,
  LegacyBlocker,
  PendingRegistrationKey,
  PendingRegistrationStore,
  RegistrationCodeClaim,
  ReservedRegistrationAttempt,
} from '../../../auth/pending-codes/pending-registration.store';
import type { BoundEmailChangeGeneration } from '../../../auth/types/prepared-email-change';
import type { RollsBack } from './own-email-memory.harness-spec';

interface MemoryCode {
  id: string;
  email: string;
  hashedCode: string;
  expiresAt: Date;
  userId?: string;
  addressGeneration?: number;
  attempts: number;
}

function keyOf(email: string, purpose: string): string {
  return `${purpose}:${storedAddress(email)}`;
}

function unused(): Error {
  return new Error('not used by the own email flows');
}

/**
 * Email-change code records with the PostgreSQL adapter's rules: one record
 * per address and purpose, a newer generation for the same account replaces
 * an older one, and a claim spends exactly the generation that was compared.
 */
export class MemoryCodes extends PendingRegistrationStore implements RollsBack {
  readonly records = new Map<string, MemoryCode>();
  private nextId = 1;

  snapshot(): () => void {
    const saved = [...this.records].map(([key, row]): [string, MemoryCode] => [
      key,
      { ...row },
    ]);
    return () => {
      this.records.clear();
      saved.forEach(([key, row]) => this.records.set(key, row));
    };
  }

  putEmailChangeCodeIn(
    _unitOfWork: UnitOfWork,
    email: string,
    generation: BoundEmailChangeGeneration,
    purpose: EmailChangePurpose,
  ): Promise<CodeRotation> {
    const key = keyOf(email, purpose);
    const stored = this.records.get(key);
    if (
      stored &&
      stored.userId === generation.userId &&
      (stored.addressGeneration ?? 0) > generation.addressGeneration
    ) {
      return Promise.resolve(CODE_ROTATION.NO_MATCHING_RECORD);
    }
    this.records.set(key, {
      id: String(this.nextId++),
      email: storedAddress(email),
      hashedCode: generation.hashedCode,
      expiresAt: generation.expiresAt,
      userId: generation.userId,
      addressGeneration: generation.addressGeneration,
      attempts: 0,
    });
    return Promise.resolve(CODE_ROTATION.ROTATED);
  }

  reserveAttempt(
    key: PendingRegistrationKey,
    rule: AttemptRule,
  ): Promise<ReservedRegistrationAttempt | null> {
    const record = this.records.get(keyOf(key.email, key.purpose));
    if (
      !record ||
      record.expiresAt <= rule.now ||
      record.attempts >= rule.maxAttempts
    ) {
      return Promise.resolve(null);
    }
    record.attempts += 1;
    return Promise.resolve({
      id: record.id,
      email: record.email,
      hashedCode: record.hashedCode,
      ...(record.userId === undefined ? {} : { userId: record.userId }),
      ...(record.addressGeneration === undefined
        ? {}
        : { addressGeneration: record.addressGeneration }),
    });
  }

  claimCode(
    _unitOfWork: UnitOfWork,
    claim: RegistrationCodeClaim,
  ): Promise<CodeClaim> {
    const found = [...this.records].find(
      ([, record]) =>
        record.id === claim.id &&
        record.hashedCode === claim.hashedCode &&
        record.expiresAt > claim.now,
    );
    if (!found) return Promise.resolve(CODE_CLAIM.NOT_CLAIMABLE);
    this.records.delete(found[0]);
    return Promise.resolve(CODE_CLAIM.CLAIMED);
  }

  dropExpiredRecord(key: PendingRegistrationKey, now: Date): Promise<void> {
    const name = keyOf(key.email, key.purpose);
    const record = this.records.get(name);
    if (record && record.expiresAt <= now) this.records.delete(name);
    return Promise.resolve();
  }

  rotateLiveCode(): Promise<CodeRotation> {
    throw unused();
  }

  replaceExpiredCode(): Promise<CodeRotation> {
    throw unused();
  }

  hasRecord(): Promise<boolean> {
    throw unused();
  }

  insertRecord(): Promise<void> {
    throw unused();
  }

  clearLegacyBlocker(): Promise<LegacyBlocker> {
    throw unused();
  }
}

/** The per-address mail cap. An address in `full` is over its cap. */
export class MemoryMailCounter extends MailCounterStore {
  readonly full = new Set<string>();
  readonly counted: string[] = [];

  recordWithinCap(key: MailCounterKey): Promise<MailRecord> {
    const address = storedAddress(key.email);
    if (this.full.has(address)) {
      return Promise.resolve(MAIL_RECORD.NOT_RECORDED);
    }
    this.counted.push(address);
    return Promise.resolve(MAIL_RECORD.RECORDED);
  }

  hasCounter(key: MailCounterKey): Promise<boolean> {
    return Promise.resolve(this.full.has(storedAddress(key.email)));
  }

  openCounter(): Promise<void> {
    throw unused();
  }

  deleteExpiredBefore(): Promise<number> {
    throw unused();
  }
}
