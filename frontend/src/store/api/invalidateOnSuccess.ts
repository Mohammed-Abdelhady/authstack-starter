/**
 * Cache tags for a mutation that only invalidates when it succeeded. A plain
 * tag list also invalidates on a rejection, which refetches reads whose
 * answer did not change.
 *
 * Safe where a rejection means the server refused the whole write: a 4xx
 * carries the field errors a form shows, so the refetch that must not happen
 * is exactly the one a rejection would trigger. Wrong where the server keeps
 * part of the write or the answer is lost; use
 * {@link invalidateOnSuccessOrUnknownOutcome} there.
 *
 * @example
 * ```ts
 * invalidatesTags: invalidateOnSuccess(['User']),
 * invalidatesTags: invalidateOnSuccess(({ userId }) => [{ type: 'User', id: userId }]),
 * ```
 */
export function invalidateOnSuccess<const Tag, Arg = unknown>(
  tags: readonly Tag[] | ((arg: Arg) => readonly Tag[]),
): (result: unknown, error: unknown, arg: Arg) => readonly Tag[] {
  return (_result, error, arg) => {
    if (error) return [];
    return typeof tags === 'function' ? tags(arg) : tags;
  };
}

/** Lowest HTTP status whose answer is a server failure, not a refused write. */
const SERVER_ERROR_STATUS_MIN = 500;

/**
 * The same shape as `invalidateOnSuccess`, for mutations whose server writes
 * first and answers an error afterwards. A rejection with no HTTP status
 * behind it (request or answer lost on the network, or a body that failed to
 * parse) or a status of 5xx leaves the outcome unknown: the write may have
 * landed, so the cache is refetched rather than trusted. A 4xx still answers
 * "not applied" and still carries field errors, so it refetches nothing and
 * the profile-form bug this module exists for cannot return.
 *
 * @example
 * ```ts
 * invalidatesTags: invalidateOnSuccessOrUnknownOutcome(['User', { type: 'User', id: 'LIST' }]),
 * ```
 */
export function invalidateOnSuccessOrUnknownOutcome<const Tag, Arg = unknown>(
  tags: readonly Tag[] | ((arg: Arg) => readonly Tag[]),
): (result: unknown, error: unknown, arg: Arg) => readonly Tag[] {
  return (_result, error, arg) => {
    if (!error || outcomeUnknown(error)) {
      return typeof tags === 'function' ? tags(arg) : tags;
    }
    return [];
  };
}

/** HTTP status of a query-fetch error, when the answer carried one. */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const status: unknown = error.status;
  return typeof status === 'number' ? status : undefined;
}

/** True when the request or answer was lost, or the server itself failed. */
function outcomeUnknown(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'unknownOutcome' in error) {
    if (typeof error.unknownOutcome === 'boolean') return error.unknownOutcome;
  }
  const status = httpStatusOf(error);
  return status === undefined || status >= SERVER_ERROR_STATUS_MIN;
}
