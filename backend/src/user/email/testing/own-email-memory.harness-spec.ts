import type { SupportedLocale } from '../../../common/constants/locales';
import {
  ADDRESS_CLAIM_RESULT,
  AddressLedger,
} from '../../../common/persistence/address-ledger';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { storedAddress } from '../../../common/persistence/stored-address';
import type {
  AddressAvailability,
  AddressClaimInput,
  AddressClaimResult,
  AddressRelease,
  OwnedAddressLookup,
  StoredAddressClaim,
} from '../../../common/persistence/types/address-ledger';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import {
  ActivatedAccount,
  ActivationAccounts,
  AddressConfirmation,
  AddressOwner,
  MovedAccount,
  OwnPendingAddress,
} from '../../../auth/pending-codes/activation-accounts';

/** A fake that puts its state back when the unit of work it joined rolls back. */
export interface RollsBack {
  snapshot(): () => void;
}

class MemoryUnitOfWork extends UnitOfWork {}

/** Commits by returning and rolls every fake back on a throw, like a database. */
export class MemoryRunner extends UnitOfWorkRunner {
  readonly fakes: RollsBack[] = [];

  async run<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    const restores = this.fakes.map((fake) => fake.snapshot());
    try {
      return await work(new MemoryUnitOfWork());
    } catch (error) {
      restores.forEach((restore) => restore());
      throw error;
    }
  }
}

export function copied<Key, Value extends object>(
  rows: Map<Key, Value>,
): () => void {
  const saved = [...rows].map(([key, row]): [Key, Value] => [key, { ...row }]);
  return () => {
    rows.clear();
    saved.forEach(([key, row]) => rows.set(key, row));
  };
}

function unused(): Error {
  return new Error('not used by the own email flows');
}

export interface MemoryAccount {
  id: string;
  email: string;
  pendingEmail?: string;
  addressGeneration: number;
  locale: SupportedLocale;
  isVerified: boolean;
  isDeleted: boolean;
}

class MemoryMovedAccount extends MovedAccount {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly pendingEmail: string | undefined,
    readonly addressGeneration: number,
    readonly locale: SupportedLocale,
  ) {
    super();
  }
}

/** Accounts by id, with the unique address rule the databases keep. */
export class MemoryAccounts extends ActivationAccounts implements RollsBack {
  readonly rows = new Map<string, MemoryAccount>();

  snapshot(): () => void {
    return copied(this.rows);
  }

  add(account: MemoryAccount): void {
    this.rows.set(account.id, { ...account });
  }

  row(id: string): MemoryAccount {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no account ${id}`);
    return row;
  }

  holderOf(address: string): MemoryAccount | undefined {
    return [...this.rows.values()].find(
      (row) => row.email === storedAddress(address),
    );
  }

  newAccountId(): string {
    throw unused();
  }

  findAddressOwner(): Promise<AddressOwner | null> {
    throw unused();
  }

  isStored(): Promise<boolean> {
    throw unused();
  }

  findAddressConfirmation(userId: string): Promise<AddressConfirmation | null> {
    const row = this.rows.get(userId);
    return Promise.resolve(
      row
        ? {
            email: row.email,
            ...(row.pendingEmail === undefined
              ? {}
              : { pendingEmail: row.pendingEmail }),
            isVerified: row.isVerified,
            addressGeneration: row.addressGeneration,
            locale: row.locale,
          }
        : null,
    );
  }

  hasActiveAccount(): Promise<boolean> {
    throw unused();
  }

  insertActivated(): Promise<ActivatedAccount> {
    throw unused();
  }

  readMovedAccount(
    _unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<MovedAccount | null> {
    const row = this.rows.get(userId);
    return Promise.resolve(
      row && !row.isDeleted
        ? new MemoryMovedAccount(
            row.id,
            row.email,
            row.pendingEmail,
            row.addressGeneration,
            row.locale,
          )
        : null,
    );
  }

  confirmAddress(
    _unitOfWork: UnitOfWork,
    account: MovedAccount,
    email: string,
  ): Promise<void> {
    const row = this.rowOf(account);
    const holder = this.holderOf(email);
    if (holder && holder.id !== row.id) {
      return Promise.reject(new UniqueConflictError('user.email'));
    }
    Object.assign(row, {
      email: storedAddress(email),
      pendingEmail: undefined,
      isVerified: true,
    });
    return Promise.resolve();
  }

  savePendingAddress(
    _unitOfWork: UnitOfWork,
    account: MovedAccount,
    pending: OwnPendingAddress,
  ): Promise<void> {
    const row = this.rowOf(account);
    row.pendingEmail =
      pending.email === null ? undefined : storedAddress(pending.email);
    row.addressGeneration = pending.addressGeneration;
    return Promise.resolve();
  }

  private rowOf(account: MovedAccount): MemoryAccount {
    if (!(account instanceof MemoryMovedAccount)) {
      throw new Error('This account was not read from memory');
    }
    return this.row(account.id);
  }
}

/** The address ledger with the PostgreSQL adapter's rules. */
export class MemoryLedger extends AddressLedger implements RollsBack {
  readonly claims = new Map<string, StoredAddressClaim>();

  constructor(private readonly accounts: MemoryAccounts) {
    super();
  }

  snapshot(): () => void {
    return copied(this.claims);
  }

  claim(
    _unitOfWork: UnitOfWork,
    input: AddressClaimInput,
  ): Promise<AddressClaimResult> {
    const address = storedAddress(input.address);
    const held = this.claims.get(address);
    if (held && held.lapsesAt > input.now && held.owner !== input.owner) {
      return Promise.resolve(ADDRESS_CLAIM_RESULT.TAKEN);
    }
    // Written before the account check, so a taken answer needs a rollback.
    this.claims.set(address, {
      address,
      kind: input.kind,
      owner: input.owner,
      lapsesAt: input.lapsesAt,
    });
    const holder = this.accounts.holderOf(address);
    return Promise.resolve(
      holder && holder.id !== input.owner
        ? ADDRESS_CLAIM_RESULT.TAKEN
        : ADDRESS_CLAIM_RESULT.CLAIMED,
    );
  }

  holdsLiveClaim(
    _unitOfWork: UnitOfWork,
    input: OwnedAddressLookup,
  ): Promise<boolean> {
    const held = this.claims.get(storedAddress(input.address));
    return Promise.resolve(
      held !== undefined &&
        held.owner === input.owner &&
        held.lapsesAt > input.now,
    );
  }

  release(_unitOfWork: UnitOfWork, input: AddressRelease): Promise<void> {
    const address = storedAddress(input.address);
    if (this.claims.get(address)?.owner === input.owner) {
      this.claims.delete(address);
    }
    return Promise.resolve();
  }

  isFree(
    _unitOfWork: UnitOfWork,
    input: AddressAvailability,
  ): Promise<boolean> {
    const address = storedAddress(input.address);
    if (this.accounts.holderOf(address)) return Promise.resolve(false);
    const held = this.claims.get(address);
    return Promise.resolve(
      held === undefined ||
        held.lapsesAt <= input.now ||
        held.owner === input.owner,
    );
  }
}
