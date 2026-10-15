import type { UnitOfWork } from '../../common/persistence/unit-of-work';

/** Defaults to no refusal while erasure has no worker; plan 5 replaces this binding first. */
export abstract class ErasureLock {
  /** Plan 5 holds shared restore/erasure exclusion until this UOW ends. */
  abstract assertRestorable(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<void>;
}
