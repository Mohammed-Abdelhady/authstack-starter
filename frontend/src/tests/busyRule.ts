const NATIVE_DISABLED = /(?<![\w-])disabled=\{([^}]*)\}/g;

/**
 * Every `disabled={...}` expression in source. The test owns an explicit list
 * of existing uses so a new request-state alias cannot escape the focus check.
 */
export function disabledWhileRequestRuns(source: string): string[] {
  return [...source.matchAll(NATIVE_DISABLED)].map((match) => match[1].trim());
}
