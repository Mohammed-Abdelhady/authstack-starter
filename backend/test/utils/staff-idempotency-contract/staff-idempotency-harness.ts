import { StaffIdempotencyStore } from '../../../src/admin/stores/staff-idempotency.store';
import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../src/common/persistence/unit-of-work';
import { FrozenClock } from '../frozen-clock';

export interface StaffIdempotencyHarness {
  readonly store: StaffIdempotencyStore;
  readonly clock: FrozenClock;
  runner(pause?: RerunPause): UnitOfWorkRunner;
  records(): Promise<Array<{ requestHash: string; resourceId: string | null }>>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export type IdempotencyHarnessSource = () => StaffIdempotencyHarness;
