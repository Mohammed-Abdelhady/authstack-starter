// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  makeStore,
  registerFormTestLifecycle,
  success,
  stubNetwork,
  type TestStore,
} from '@/tests/serverRejectionHarness';
import { PROFILE } from './mutationSweepBase';
import { authApi } from '@/modules/auth/store/authApi';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

registerFormTestLifecycle();

const IDENTITY = {
  authenticated: true,
  user: {
    ...PROFILE,
    locale: 'en',
    authProvider: 'email',
    isVerified: true,
    twoFactorEnabled: false,
    passkeyCount: 0,
    linkedProviders: ['email'],
  },
} as const;

describe('session status during an identity refetch', () => {
  const status = (store: TestStore) => store.getState().auth.validationStatus;
  const readIdentity = (store: TestStore) =>
    store.dispatch(authApi.endpoints.getIdentity.initiate());
  const refetchIdentity = (store: TestStore) =>
    store.dispatch(authApi.endpoints.getIdentity.initiate(undefined, { forceRefetch: true }));

  it('is pending on the first read and stays succeeded while a later one is in flight', async () => {
    let release: (response: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    stubNetwork(() => {
      reads += 1;
      return reads === 1 ? success(IDENTITY) : held;
    });
    const store = makeStore();
    expect(status(store)).toBe('idle');

    const first = readIdentity(store);
    expect(status(store)).toBe('pending');
    await first;
    expect(status(store)).toBe('succeeded');

    const refetch = refetchIdentity(store);
    expect(status(store)).toBe('succeeded');
    release(success(IDENTITY));
    await refetch;
    expect(status(store)).toBe('succeeded');
  });
});
