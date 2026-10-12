// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
  type TestStore,
} from '@/tests/serverRejectionHarness';
import { baseApi } from '@/store/api/baseApi';
import { authApi } from '@/modules/auth/store/authApi';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const PROFILE = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  linkedProviders: ['email'],
};

const SIGNED_OUT = () => refusalWith(401, 'SESSION_INVALID');

const readProfile = (store: TestStore) =>
  store.dispatch(authApi.endpoints.getCurrentUser.initiate());
const refetchProfile = (store: TestStore) =>
  store.dispatch(authApi.endpoints.getCurrentUser.initiate(undefined, { forceRefetch: true }));
const saveProfile = (store: TestStore) =>
  store.dispatch(authApi.endpoints.updateProfile.initiate({ name: 'Layla H' }));
const changePassword = (store: TestStore) =>
  store.dispatch(
    authApi.endpoints.changePassword.initiate({
      currentPassword: 'OldPassw0rdLayla',
      newPassword: 'NewPassw0rdLayla',
    }),
  );

async function settled(store: TestStore): Promise<void> {
  await Promise.all(store.dispatch(baseApi.util.getRunningQueriesThunk()));
}

/** What the store believes about the session. */
function session(store: TestStore) {
  const { validationStatus, validationErrorStatus, isAuthenticated, user } = store.getState().auth;
  return { validationStatus, validationErrorStatus, isAuthenticated, name: user?.name ?? null };
}

registerFormTestLifecycle();

describe('a 401 on a write', () => {
  it('starts one session check, which signs the person out', async () => {
    let profileReads = 0;
    const requests = stubNetwork((request) => {
      if (request.method !== 'GET') return SIGNED_OUT();
      profileReads += 1;
      return profileReads === 1 ? success(PROFILE) : SIGNED_OUT();
    });
    const store = makeStore();
    await readProfile(store);

    await saveProfile(store);
    await settled(store);

    expect(requests).toEqual([
      'GET /api/user/profile',
      'PATCH /api/user/profile',
      'GET /api/user/profile',
    ]);
    expect(session(store)).toEqual({
      validationStatus: 'failed',
      validationErrorStatus: 401,
      isAuthenticated: false,
      name: null,
    });
  });

  it('starts one session check for two writes that fail together', async () => {
    let answerCheck: (response: Response) => void = () => undefined;
    const check = new Promise<Response>((resolve) => {
      answerCheck = resolve;
    });
    let profileReads = 0;
    const requests = stubNetwork((request) => {
      if (request.method !== 'GET') return SIGNED_OUT();
      profileReads += 1;
      return profileReads === 1 ? success(PROFILE) : check;
    });
    const store = makeStore();
    await readProfile(store);

    await Promise.all([saveProfile(store), changePassword(store)]);
    answerCheck(SIGNED_OUT());
    await settled(store);

    expect(requests.filter((request) => request === 'GET /api/user/profile')).toHaveLength(2);
    expect(session(store).isAuthenticated).toBe(false);
  });

  it('keeps the session when the check says it is still valid', async () => {
    const requests = stubNetwork((request) =>
      request.method === 'GET' ? success(PROFILE) : SIGNED_OUT(),
    );
    const store = makeStore();
    await readProfile(store);

    await saveProfile(store);
    await settled(store);

    expect(requests).toEqual([
      'GET /api/user/profile',
      'PATCH /api/user/profile',
      'GET /api/user/profile',
    ]);
    expect(session(store)).toEqual({
      validationStatus: 'succeeded',
      validationErrorStatus: null,
      isAuthenticated: true,
      name: 'Layla Haddad',
    });
  });

  it('starts no session check for a person who is not signed in', async () => {
    const requests = stubNetwork(() => SIGNED_OUT());
    const store = makeStore();

    await saveProfile(store);
    await settled(store);

    expect(requests).toEqual(['PATCH /api/user/profile']);
  });
});

describe('session status transitions', () => {
  it('fails a first read the server could not answer', async () => {
    stubNetwork(() => refusalWith(503, 'AUTHORITY_UNAVAILABLE'));
    const store = makeStore();

    await readProfile(store);

    expect(session(store)).toEqual({
      validationStatus: 'failed',
      validationErrorStatus: 503,
      isAuthenticated: false,
      name: null,
    });
  });

  it('goes back to pending when the person retries after a failed first read', async () => {
    let answerRetry: (response: Response) => void = () => undefined;
    const retry = new Promise<Response>((resolve) => {
      answerRetry = resolve;
    });
    let reads = 0;
    stubNetwork(() => {
      reads += 1;
      return reads === 1 ? refusalWith(503, 'AUTHORITY_UNAVAILABLE') : retry;
    });
    const store = makeStore();
    await readProfile(store);

    const retried = refetchProfile(store);
    expect(session(store).validationStatus).toBe('pending');
    answerRetry(success(PROFILE));
    await retried;

    expect(session(store).validationStatus).toBe('succeeded');
  });

  it.each([
    ['a 503', () => refusalWith(503, 'AUTHORITY_UNAVAILABLE')],
    ['a 500', () => refusalWith(500, 'INTERNAL_ERROR')],
    [
      'a network failure',
      (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch')),
    ],
  ])('keeps a validated session and its user through %s on a refetch', async (_label, answer) => {
    let reads = 0;
    stubNetwork(() => {
      reads += 1;
      return reads === 1 ? success(PROFILE) : answer();
    });
    const store = makeStore();
    await readProfile(store);

    await refetchProfile(store);

    expect(session(store)).toEqual({
      validationStatus: 'succeeded',
      validationErrorStatus: null,
      isAuthenticated: true,
      name: 'Layla Haddad',
    });
    expect(store.getState().auth.isLoading).toBe(false);
  });

  it('ends a validated session when the refetch answers 401', async () => {
    let reads = 0;
    stubNetwork(() => {
      reads += 1;
      return reads === 1 ? success(PROFILE) : SIGNED_OUT();
    });
    const store = makeStore();
    await readProfile(store);

    await refetchProfile(store);

    expect(session(store)).toEqual({
      validationStatus: 'failed',
      validationErrorStatus: 401,
      isAuthenticated: false,
      name: null,
    });
  });

  it('is not disturbed by a second reader of a read already in flight', async () => {
    let answerRead: (response: Response) => void = () => undefined;
    const read = new Promise<Response>((resolve) => {
      answerRead = resolve;
    });
    const requests = stubNetwork(() => read);
    const store = makeStore();

    const first = readProfile(store);
    const second = readProfile(store);
    // The store learns that the second read was skipped once the pending work has run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(session(store)).toEqual({
      validationStatus: 'pending',
      validationErrorStatus: null,
      isAuthenticated: false,
      name: null,
    });
    expect(store.getState().auth.isLoading).toBe(true);
    answerRead(success(PROFILE));
    await Promise.all([first, second]);

    expect(requests).toEqual(['GET /api/user/profile']);
    expect(session(store).validationStatus).toBe('succeeded');
  });
});
