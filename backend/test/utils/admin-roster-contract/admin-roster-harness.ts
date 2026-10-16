import { AdminRosterStore } from '../../../src/admin/stores/admin-roster.store';
import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../src/common/persistence/unit-of-work';

export interface RosterAccountInput {
  readonly email: string;
  readonly role?: string;
  readonly deleted?: boolean;
  readonly verified?: boolean;
  readonly pendingEmail?: string;
}

export interface AdminRosterHarness {
  readonly roster: AdminRosterStore;
  runner(pause?: RerunPause): UnitOfWorkRunner;
  seedAccount(input: RosterAccountInput): Promise<string>;
  seedPasskey(userId: string, rpId?: string): Promise<void>; // feature:passkeys
  contention(afterCommit: Promise<void>): {
    runner: UnitOfWorkRunner;
    blocked(): Promise<void>;
    stop(): void;
  };
  reset(): Promise<void>;
  close(): Promise<void>;
}

export type RosterHarnessSource = () => AdminRosterHarness;
