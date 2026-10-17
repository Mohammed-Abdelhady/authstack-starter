import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@app/core';
import {
  refusalWith,
  stubNetwork,
  success,
  makeStore,
  type TestStore,
} from '@/tests/serverRejectionHarness';
import { baseApi } from '@/store/api/baseApi';
import { authApi } from '@/modules/auth/store/authApi';
import { sessionsApi } from '@/modules/sessions/api/sessionsApi';
import { usersApi } from '@/modules/users/api/usersApi';
import { rolesApi } from '@/modules/roles/api/rolesApi';
import { permissionsApi } from '@/modules/permissions/api/permissionsApi';

export type Dispatched = (store: TestStore) => PromiseLike<unknown>;

/** One write under test, against a real store with only the network stubbed. */
export interface MutationCase {
  name: string;
  /** Reads a page keeps subscribed while the form is open, in this order. */
  reads: Dispatched[];
  write: Dispatched;
  /** What the server answers when it accepts the write. */
  accepted: unknown;
  /** Requests up to and including the write. */
  requests: string[];
  /** Reads the cache repeats after an accepted write. */
  refetched: string[];
  /** Set when the server keeps part of the write: a 503 or a lost answer must repeat the reads too. */
  outcomeUnknown?: boolean;
}

/** Hand-written request strings, ordered as the cases issue them. */
export const GET_PROFILE = 'GET /api/user/profile';
export const GET_SESSIONS = 'GET /api/user/sessions';
export const GET_USERS = 'GET /api/admin/users';
export const GET_USER = 'GET /api/admin/users/user-2';
export const GET_ROLES = 'GET /api/roles';
export const GET_ROLE = 'GET /api/roles/editor';
export const GET_PERMISSIONS = 'GET /api/admin/users/user-2/permissions';

export const PROFILE = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'admin',
  permissions: [],
};

/** Body every sign-in or verify route answers with. */
export const LOGIN_RESPONSE = { requiresTwoFactor: false, user: PROFILE };

export const ADMIN_USER = {
  version: 0,
  id: 'user-2',
  email: 'omar@example.com',
  name: 'Omar Nasser',
  role: 'user',
  isVerified: true,
  isDeleted: false,
  authProvider: 'email',
  linkedProviders: ['email'],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

export const ROLE = { version: 0, id: 'editor', name: 'Editor', slug: 'editor' };

export const PERMISSIONS = {
  version: 0,
  userId: 'user-2',
  permissions: ['roles.read'],
  role: 'user',
};

/**
 * What every read answers, by path: the reads of the core slices. Feature
 * suites pass the answers of their own reads to the describe helpers.
 */
const READS: Record<string, unknown> = {
  '/api/user/profile': PROFILE,
  '/api/user/sessions': { sessions: [] },
  '/api/admin/users': {
    data: [ADMIN_USER],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  },
  '/api/admin/users/user-2': ADMIN_USER,
  '/api/roles': { roles: [ROLE], total: 1, page: 1, pages: 1 },
  '/api/roles/editor': ROLE,
  '/api/admin/users/user-2/permissions': PERMISSIONS,
};

/** The subscribed reads the core cases keep open while their write runs. */
export const readProfile: Dispatched = (store) =>
  store.dispatch(authApi.endpoints.getCurrentUser.initiate());
export const readSessions: Dispatched = (store) =>
  store.dispatch(sessionsApi.endpoints.getSessions.initiate());
export const readUsers: Dispatched = (store) =>
  store.dispatch(usersApi.endpoints.getUsers.initiate({}));
export const readUser: Dispatched = (store) =>
  store.dispatch(usersApi.endpoints.getUserById.initiate('user-2'));
export const readRoles: Dispatched = (store) =>
  store.dispatch(rolesApi.endpoints.listRoles.initiate(undefined));
export const readRole: Dispatched = (store) =>
  store.dispatch(rolesApi.endpoints.getRole.initiate('editor'));
export const readPermissions: Dispatched = (store) =>
  store.dispatch(permissionsApi.endpoints.getUserPermissions.initiate('user-2'));

/**
 * Runs the reads, then the write, and waits for every refetch the write
 * caused. The write must dispatch the endpoint the case names: the store's
 * mutation entries after it settle name exactly what ran. Extra reads answers
 * belong to the case list's suite: the runner merges them into the core
 * reads it answers.
 */
export async function requestsOf(
  mutation: MutationCase,
  writeAnswer: (request: Request, path: string) => Response,
  extraReads: Record<string, unknown> = {},
): Promise<string[]> {
  const answers = { ...READS, ...extraReads };
  const requests = stubNetwork((request, path) =>
    request.method === 'GET' ? success(answers[path]) : writeAnswer(request, path),
  );
  const store = makeStore();
  for (const read of mutation.reads) {
    await read(store);
  }
  await mutation.write(store);
  const endpointNames = Object.values(store.getState().api.mutations)
    .filter(
      (entry): entry is NonNullable<typeof entry> => entry !== undefined && 'endpointName' in entry,
    )
    .map((entry) => entry.endpointName);
  expect(endpointNames, `the ${mutation.name} case must dispatch the endpoint it names`).toEqual([
    mutation.name,
  ]);
  await Promise.all(store.dispatch(baseApi.util.getRunningQueriesThunk()));
  return requests;
}

/**
 * The behaviour suite of every success-only mutation of a case list. A 4xx
 * answer must leave the cache alone; a success repeats exactly the reads its
 * tags invalidated; a case whose server keeps part of the write must also
 * refetch when the answer is a 5xx or lost.
 */
export function describeSuccessOnly(
  cases: MutationCase[],
  extraReads: Record<string, unknown> = {},
): void {
  describe.each(cases)('$name', (mutation) => {
    it('issues no read after a 400 refusal', async () => {
      expect(
        await requestsOf(mutation, () => refusalWith(400, ErrorCode.VALIDATION_ERROR), extraReads),
      ).toEqual(mutation.requests);
    });

    it('repeats its reads after a 503, whose save may have landed', async () => {
      const requests = await requestsOf(
        mutation,
        () => refusalWith(503, ErrorCode.AUTHORITY_UNAVAILABLE),
        extraReads,
      );
      expect(requests.slice(0, mutation.requests.length)).toEqual(mutation.requests);
      expect(requests.slice(mutation.requests.length).sort()).toEqual(
        mutation.outcomeUnknown ? [...mutation.refetched].sort() : [],
      );
    });

    it('repeats its reads when no answer arrives at all', async () => {
      const requests = await requestsOf(
        mutation,
        () => {
          throw new TypeError('Failed to fetch');
        },
        extraReads,
      );
      expect(requests.slice(0, mutation.requests.length)).toEqual(mutation.requests);
      expect(requests.slice(mutation.requests.length).sort()).toEqual(
        mutation.outcomeUnknown ? [...mutation.refetched].sort() : [],
      );
    });

    it('repeats only its own reads after the server accepted it', async () => {
      const requests = await requestsOf(mutation, () => success(mutation.accepted), extraReads);
      expect(requests.slice(0, mutation.requests.length)).toEqual(mutation.requests);
      expect(requests.slice(mutation.requests.length).sort()).toEqual(
        [...mutation.refetched].sort(),
      );
    });
  });
}

/**
 * The behaviour suite of every mutation that invalidates nothing: neither a
 * refusal nor a success may repeat the subscribed reads.
 */
export function describeUntagged(
  cases: MutationCase[],
  extraReads: Record<string, unknown> = {},
): void {
  describe.each(cases)('$name', (mutation) => {
    it('issues no read after a 400 refusal', async () => {
      expect(
        await requestsOf(mutation, () => refusalWith(400, ErrorCode.VALIDATION_ERROR), extraReads),
      ).toEqual(mutation.requests);
    });

    it('repeats nothing after the server accepted it', async () => {
      const requests = await requestsOf(mutation, () => success(mutation.accepted), extraReads);
      expect(requests.slice(mutation.requests.length)).toEqual([]);
    });
  });
}
