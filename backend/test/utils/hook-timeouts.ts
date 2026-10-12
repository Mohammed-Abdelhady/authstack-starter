/**
 * Jest hook budget for database startup and application boot. The slowest
 * boot measured took 27 seconds, on a cold transform cache.
 */
export const SESSION_AUTHORITY_BOOT_TIMEOUT_MS = 60000;

/**
 * Jest hook budget for database teardown and application shutdown. Jest's own
 * default: the slowest teardown measured took 0.2 seconds.
 */
export const SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS = 5000;

/**
 * Jest hook budget for emptying the stored state and seeding a case's first
 * records. Jest's own default: the slowest reset measured took 0.6 seconds.
 */
export const SESSION_AUTHORITY_RESET_TIMEOUT_MS = 5000;
