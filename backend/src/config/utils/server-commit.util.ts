const SERVER_COMMIT_LENGTH = 40;
const SERVER_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export function parseServerCommit(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length === SERVER_COMMIT_LENGTH &&
    SERVER_COMMIT_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}
