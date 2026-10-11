/** Jest hook budget for database startup and application boot under load. */
export const SESSION_AUTHORITY_BOOT_TIMEOUT_MS = 60000;

/** Jest hook budget for database teardown and application shutdown under load. */
export const SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS = 60000;

/** Jest hook budget for emptying the stored state and seeding a case's first records under load. */
export const SESSION_AUTHORITY_RESET_TIMEOUT_MS = 10000;
