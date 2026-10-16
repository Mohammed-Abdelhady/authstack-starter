export const MS_PER_DAY = 86_400_000;

/** How far an erasure got. A run that died resumes at the step recorded. */
export const ERASURE_STEP = {
  /** Step 1 committed: nothing can restore the account from here. */
  ERASING: 'erasing',
  /** Step 2: the host hook answered. */
  HOOK_DONE: 'hook_done',
  /** Step 3: the account and every row that pointed at it are gone. */
  ERASED: 'erased',
} as const;

export type ErasureStep = (typeof ERASURE_STEP)[keyof typeof ERASURE_STEP];

/** The reason a job failed. Always a code, never an error's text. */
export const ERASURE_FAILURE = {
  HOOK_FAILED: 'hook_failed',
  ERASE_FAILED: 'erase_failed',
} as const;

/** What a restore finds when it takes the account. */
export const ERASURE_STANDING = {
  RESTORABLE: 'restorable',
  ERASING: 'erasing',
} as const;

export type ErasureStanding =
  (typeof ERASURE_STANDING)[keyof typeof ERASURE_STANDING];

/** A code a host hook may give its failure, prefixed `hook:` when stored. */
export const ERASURE_HOOK_CODE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const ERASURE_HOOK_CODE_PREFIX = 'hook:';

/** Accounts one run claims at most. The rest wait for the next run. */
export const ERASURE_BATCH_SIZE = 10;
export const ERASURE_INTERVAL_MS = 60_000;
/** Longer than any healthy hook call, so a live worker keeps its accounts. */
export const ERASURE_LEASE_MS = 15 * 60_000;
export const ERASURE_RETRY_BASE_MS = 60_000;
export const ERASURE_RETRY_MAX_MS = MS_PER_DAY;
/** How long a finished job row stays, with its times and reason codes. */
export const ERASURE_JOB_KEEP_DAYS = 90;
export const ERASURE_JOB_LIST_LIMIT = 100;
/** Accounts the schedule command dates in one statement. */
export const ERASURE_SCHEDULE_BATCH = 500;
