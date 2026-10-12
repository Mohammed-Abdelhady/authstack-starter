/**
 * Identifies the current session from the authenticated request.
 *
 * Every route that needs "the current session" uses this helper on
 * `request.session`, so cookie and bearer callers are treated alike. Reading
 * the session cookie here would leave bearer callers with no current session.
 */
export interface RequestWithSession {
  session?: { id?: string } | null;
}

export function requestSessionId(request: RequestWithSession): string | null {
  const id = request.session?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
