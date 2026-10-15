import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import {
  AddressClaimInput,
  StoredAddressClaim,
} from '../../../src/common/persistence/types/address-ledger';
import {
  RerunPause,
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../src/common/persistence/unit-of-work';
import { FrozenClock } from '../frozen-clock';

export interface AddressLedgerHarness {
  readonly ledger: AddressLedger;
  readonly clock: FrozenClock;
  runner(pause?: RerunPause): UnitOfWorkRunner;
  retryableAbort(): Error;
  claims(): Promise<StoredAddressClaim[]>;
  accounts(): Promise<Array<{ email: string | null; deleted: boolean }>>;
  seedClaim(claim: AddressClaimInput): Promise<void>;
  seedAccount(address: string, deleted?: boolean): Promise<string>;
  insertAccount(uow: UnitOfWork, address: string): Promise<string>;
  contention(afterCommit: Promise<void>): {
    runner: UnitOfWorkRunner;
    blocked(): Promise<void>;
    stop(): void;
  };
  reset(): Promise<void>;
  close(): Promise<void>;
}

export type LedgerHarnessSource = () => AddressLedgerHarness;
