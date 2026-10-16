const MILLISECONDS_PER_MINUTE = 60000;

/**
 * The lifetime a code mail states: the time left rounded up, so a code with
 * seconds left never says zero, and never more than the configured lifetime.
 */
export function mailedCodeMinutes(
  remainingMs: number,
  configuredMs: number,
): number {
  const ceiling = Math.max(
    1,
    Math.floor(configuredMs / MILLISECONDS_PER_MINUTE),
  );
  return Math.min(Math.ceil(remainingMs / MILLISECONDS_PER_MINUTE), ceiling);
}
