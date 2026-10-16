import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { ErasureStanding } from '../constants/erasure.constants';
import type {
  BegunErasure,
  ErasureFailure,
  ErasureJob,
  ErasureLease,
  UnscheduledSelection,
} from '../types/erasure';

/**
 * Erasure jobs, one per account, and the schedule on the account they start
 * from. Step 1 and a restore both take the account row first, so one of them
 * waits for or refuses the other and never both go on.
 */
export abstract class ErasureJobStore {
  /**
   * Deactivated accounts whose `erase_after` has passed, oldest first,
   * leaving out a finished job, a live lease of another worker and a job
   * waiting for its retry.
   */
  abstract findDue(now: Date, limit: number): Promise<string[]>;

  /**
   * Step 1. Takes the account row. When it is still deactivated and due, and
   * its job is free, writes the job at `erasing` (or keeps the step it
   * reached) under this lease. Null when another unit of work holds the row,
   * the account is not due, or the job is someone else's or waiting.
   */
  abstract beginIn(
    unitOfWork: UnitOfWork,
    userId: string,
    lease: ErasureLease,
  ): Promise<BegunErasure | null>;

  /** Records step 2 while the lease holds. False when the lease was lost. */
  abstract markHookDone(jobId: string, lease: ErasureLease): Promise<boolean>;

  /** Counts a failed attempt, keeps its code, frees the lease until `nextAttemptAt`. */
  abstract markFailed(
    jobId: string,
    owner: string,
    failure: ErasureFailure,
  ): Promise<void>;

  /** Step 3's last write. False when the job had already finished. */
  abstract finishIn(
    unitOfWork: UnitOfWork,
    jobId: string,
    erasedAt: Date,
    purgeAfter: Date,
  ): Promise<boolean>;

  /**
   * Removes a job that has not finished, for an account step 3 found no
   * longer due. A later deletion then starts again at step 1, and a restore
   * is not refused for an erasure that never happened.
   */
  abstract withdrawIn(unitOfWork: UnitOfWork, jobId: string): Promise<void>;

  /**
   * For a restore: takes the account row, answers whether step 1 committed,
   * and when it did not, clears the schedule so the restored account is no
   * longer due.
   */
  abstract holdForRestoreIn(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<ErasureStanding>;

  /** Jobs that have not finished, newest first. */
  abstract listOpen(limit: number): Promise<ErasureJob[]>;

  /**
   * Dates deactivated accounts that have no schedule and whose deactivation
   * is the person's own deletion, never a staff one. Answers how many.
   */
  abstract scheduleUnscheduled(
    selection: UnscheduledSelection,
    limit: number,
  ): Promise<number>;
}
