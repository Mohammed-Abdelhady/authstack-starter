import type { CallOptions } from '../client';
import { HTTP_METHOD, HTTP_STATUS_OK } from '../constants';
import { assertProfileVersion } from '../identity';
import { unwrapSessionList } from '../sessions';
import type { TransportSignal } from '../transport';
import type {
  MessageResult,
  RevokeOtherSessionsResult,
  SessionList,
  UpdateProfileRequest,
  User,
} from '../types';
import { pathSegment } from './path-segment';
import type { AreaSenders } from './shared';

export const USER_PATHS = {
  profile: '/api/user/profile',
  sessions: '/api/user/sessions',
  /** @throws TypeError for an empty id, `.` or `..` */
  session: (sessionId: string) => `/api/user/sessions/${pathSegment(sessionId, 'session id')}`,
  revokeOtherSessions: '/api/user/sessions/revoke-others',
} as const;

export interface ApiClientUser<TSignal extends TransportSignal = TransportSignal> {
  profile: {
    get(options?: CallOptions<TSignal>): Promise<User>;
    update(changes: UpdateProfileRequest, options?: CallOptions<TSignal>): Promise<User>;
  };
  sessions: {
    /**
     * Lists browser and native sessions. The row of the session making the
     * call, cookie or bearer, reads `isCurrent: true` and carries its
     * `credentialPurpose`.
     */
    list(options?: CallOptions<TSignal>): Promise<SessionList>;
    /**
     * Refuses the session making the call with `CANNOT_REVOKE_CURRENT_SESSION`.
     * Rejects with a `TypeError` for an empty id, `.` or `..`.
     */
    revoke(sessionId: string, options?: CallOptions<TSignal>): Promise<MessageResult>;
    /** Revokes every session except the one making the call. */
    revokeOthers(options?: CallOptions<TSignal>): Promise<RevokeOtherSessionsResult>;
  };
}

export function createUserArea<TSignal extends TransportSignal>({
  send,
  sendObject,
}: AreaSenders<TSignal>): ApiClientUser<TSignal> {
  return {
    profile: {
      get: async (options) =>
        checkedProfile(
          await sendObject<User>({ method: HTTP_METHOD.GET, path: USER_PATHS.profile }, options),
        ),
      update: async (changes, options) =>
        checkedProfile(
          await sendObject<User>(
            { method: HTTP_METHOD.PATCH, path: USER_PATHS.profile, body: changes },
            options,
          ),
        ),
    },
    sessions: {
      list: async (options) =>
        unwrapSessionList(
          await send({ method: HTTP_METHOD.GET, path: USER_PATHS.sessions }, options),
        ),
      // Async, so a refused id is a rejection like every other failure.
      revoke: async (sessionId, options) =>
        sendObject({ method: HTTP_METHOD.DELETE, path: USER_PATHS.session(sessionId) }, options),
      revokeOthers: (options) =>
        sendObject({ method: HTTP_METHOD.POST, path: USER_PATHS.revokeOtherSessions }, options),
    },
  };
}

export { pathSegment };

function checkedProfile(user: User): User {
  assertProfileVersion(user.version, HTTP_STATUS_OK);
  return user;
}
