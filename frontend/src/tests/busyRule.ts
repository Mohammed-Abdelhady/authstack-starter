/** Names a component gives the state of a request it is waiting for. */
const REQUEST_STATE =
  /\b(?:busy|is(?:Loading|Fetching|Submitting|Pending|Busy|Updating\w*|Removing|Deleting|Revoking|Saving|Creating|LoggingOut|Resending|Retrying|Redirecting|Sync\w+|Unlinking|SettingPrimary|ResendDisabled|Cooling))\b/;

const NATIVE_DISABLED = /(?<![\w-])disabled=\{([^}]*)\}/g;

/**
 * The `disabled={...}` expressions in a source text that follow the state of a
 * request. Such a control loses focus to the page body when the request
 * starts: it takes `busy` instead, which holds it without that.
 */
export function disabledWhileRequestRuns(source: string): string[] {
  return [...source.matchAll(NATIVE_DISABLED)]
    .map((match) => match[1].trim())
    .filter((expression) => REQUEST_STATE.test(expression));
}
