/** A usage error: a bad flag, a bad config file or a bad selection. Exit 2, nothing written. */
export class CliError extends Error {}

/** The installed package itself is damaged. Its own exit code, nothing written. */
export class BrokenPackageError extends Error {}
