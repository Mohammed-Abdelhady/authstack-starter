import type { InvitationStore } from '../../../src/auth/invitations/stores/invitation.store';
import type { AddressLedger } from '../../../src/common/persistence/address-ledger';
import type {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../src/common/persistence/unit-of-work';
import type { FrozenClock } from '../frozen-clock';

export interface InvitationHarness {
  store: InvitationStore;
  ledger: AddressLedger;
  clock: FrozenClock;
  runner(pause?: RerunPause): UnitOfWorkRunner;
  seedAccount(email: string): Promise<string>;
  contention(afterCommit: Promise<void>): {
    runner: UnitOfWorkRunner;
    blocked(): Promise<void>;
    stop(): void;
  };
  reset(): Promise<void>;
  close(): Promise<void>;
}

export type InvitationHarnessSource = () => InvitationHarness;
