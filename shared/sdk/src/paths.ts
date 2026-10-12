import { UNSAFE_PATH_SEGMENTS } from './constants';

/**
 * One value as one path segment. `encodeURIComponent` leaves `.` and `..`
 * alone and a URL parser resolves them, so they are refused along with the
 * empty string instead of being sent to another route.
 */
function pathSegment(value: string, name: string): string {
  if (UNSAFE_PATH_SEGMENTS.has(value)) {
    throw new TypeError(`${name} cannot be used in a path: ${JSON.stringify(value)}`);
  }
  return encodeURIComponent(value);
}

/** Every route the client calls, in one place. */
export const API_PATHS = {
  user: {
    profile: '/api/user/profile',
    sessions: '/api/user/sessions',
    /** @throws TypeError for an empty id, `.` or `..` */
    session: (sessionId: string) => `/api/user/sessions/${pathSegment(sessionId, 'session id')}`,
    revokeOtherSessions: '/api/user/sessions/revoke-others',
  },
  auth: {
    identity: '/api/auth/identity',
    methods: '/api/auth/methods',
    logout: '/api/auth/logout',
  },
  oauth: {
    token: '/api/oauth/token',
    revoke: '/api/oauth/revoke',
  },
} as const;
