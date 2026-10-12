/**
 * One atomic piece of work on the database. Only the adapter that opened it
 * can look inside, so a service can pass it on and nothing else.
 */
export abstract class UnitOfWork {
  protected readonly kind = 'unit-of-work';
}

/** How many times a unit of work runs before a retryable abort is final. */
export const MAX_UNIT_OF_WORK_ATTEMPTS = 3;

const RERUN_PAUSE_STEP_MS = 50;

/** Waits between a retryable abort and the rerun. Receives the attempts failed so far. */
export type RerunPause = (failedAttempts: number) => Promise<void>;

export const pauseBeforeRerun: RerunPause = (failedAttempts) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, RERUN_PAUSE_STEP_MS * failedAttempts);
  });

/** Injection token for the pause a unit of work takes before it reruns. */
export const UNIT_OF_WORK_RERUN_PAUSE = Symbol('UNIT_OF_WORK_RERUN_PAUSE');

/**
 * Owns the transaction. The caller never begins, commits or rolls back.
 *
 * - A normal return from `work` commits. A throw rolls back and is rethrown.
 * - A store failure inside `work` ends the unit of work: `work` must let it
 *   through. It leaves `run` as one of the shared persistence errors.
 * - A `RetryableAbortError` reruns the whole `work` on a fresh unit of work, up
 *   to `MAX_UNIT_OF_WORK_ATTEMPTS`, so `work` must not keep state between runs.
 * - A commit whose answer was lost is never rerun. It leaves `run` as an
 *   `UnknownTransactionOutcomeError`.
 */
export abstract class UnitOfWorkRunner {
  abstract run<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result>;

  /** Lets an adapter coordinate concurrent operations from one actor. */
  runForAuthority<Result>(
    _actorId: string,
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    return this.run(work);
  }
}
