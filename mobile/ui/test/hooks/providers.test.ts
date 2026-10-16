import type { AbortSignalPort, ProviderSignInPort } from '@app/native-auth';
import type {
  NativeMethods,
  NativeProviderMethod,
  Transport,
  TransportRequest,
  TransportResponse,
} from '@app/sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../src/context/ui-context';
import { useProviders } from '../../src/hooks/use-providers';
import { deferred, signedInAs, type Deferred } from '../support/fake-engine';
import { ok, refusal } from '../support/fake-server';
import { renderUiHook } from '../support/hook';
import { device } from '../support/react-native';
import { cleanup, flush } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(cleanup);

const METHOD: NativeProviderMethod = {
  id: 'google',
  displayName: 'Google',
  mode: 'googleIdentityToken',
  sdk: { kind: 'google', webClientId: 'client-1' },
};
const METHODS: NativeMethods = {
  nativeEnabled: true,
  methods: { password: true, magicLink: false, passkeys: false, twoFactor: false, oauth: [] },
  capabilities: {
    password: true,
    emailLink: false,
    passkeys: false,
    registration: false,
    recovery: false,
  },
  providers: [METHOD],
};
const FACEBOOK: NativeProviderMethod = {
  id: 'facebook',
  displayName: 'Facebook',
  mode: 'facebook',
  sdk: { kind: 'facebook', appId: '1234' },
};
const CREDENTIAL = {
  kind: 'googleIdentityToken',
  identityToken: 'proof-1',
  nonceDigest: 'ab'.repeat(32),
} as const;
const LIST = { providers: ['email'], unlinkHints: { email: 'not_removable' }, primaryHints: {} };
const START = {
  linkId: 'link-1',
  nonceDigest: 'ab'.repeat(32),
  state: 'state-1',
  expiresAt: '2026-06-10T08:12:00.000Z',
};

async function setup(methods: NativeMethods = METHODS) {
  const calls: {
    request: TransportRequest<AbortSignalPort>;
    answer: Deferred<TransportResponse>;
  }[] = [];
  const transport: Transport<AbortSignalPort> = {
    request(request) {
      const answer = deferred<TransportResponse>();
      calls.push({ request, answer });
      return answer.promise;
    },
  };
  const authenticate = vi.fn<ProviderSignInPort['authenticate']>(async () => ({
    kind: 'success',
    value: CREDENTIAL,
  }));
  const port: ProviderSignInPort = { available: async () => true, authenticate };
  const subject = await renderUiHook(() => {
    const { runtime } = useUi();
    runtime.engine.transport.request = transport.request;
    runtime.engine.methods = async () => methods;
    return useProviders(port);
  }, signedInAs('ada'));
  async function answer(index: number, response: TransportResponse) {
    await act(async () => calls[index]?.answer.resolve(response));
    await flush();
  }
  await answer(0, ok(LIST));
  async function start() {
    act(() => subject.current().link(METHOD));
    await flush();
    await answer(1, ok(START));
  }
  return { subject, calls, authenticate, answer, start };
}

describe('provider account linking', () => {
  it('binds the native proof to the start nonce, state and link id before reloading', async () => {
    const app = await setup();
    await app.start();
    expect(app.calls[1]?.request).toMatchObject({
      method: 'POST',
      path: '/api/user/providers/link/start',
      body: { provider: 'google' },
    });
    expect(app.authenticate).toHaveBeenCalledWith(
      {
        method: METHOD,
        nonceDigest: 'abababababababababababababababababababababababababababababababab',
        state: 'state-1',
      },
      expect.objectContaining({ aborted: false }),
    );
    expect(app.calls[2]?.request).toMatchObject({
      method: 'POST',
      path: '/api/user/providers/link/finish',
      body: {
        linkId: 'link-1',
        credential: {
          kind: 'googleIdentityToken',
          identityToken: 'proof-1',
          nonceDigest: 'abababababababababababababababababababababababababababababababab',
        },
      },
    });
    await app.answer(2, ok({ id: 'ada' }));
    await app.answer(
      3,
      ok({
        providers: ['email', 'google'],
        primaryProvider: 'google',
        unlinkHints: {},
        primaryHints: {},
      }),
    );
    expect(app.subject.current().list?.providers).toEqual(['email', 'google']);
  });

  it('offers Facebook for linking only on iOS, where its proof carries the nonce', async () => {
    const withFacebook = { ...METHODS, providers: [METHOD, FACEBOOK] };
    const android = await setup(withFacebook);
    expect(android.subject.current().linkable.map((method) => method.id)).toEqual(['google']);
    cleanup();
    device.platform = 'ios';
    const ios = await setup(withFacebook);
    expect(ios.subject.current().linkable.map((method) => method.id)).toEqual([
      'google',
      'facebook',
    ]);
  });

  it('preserves the list and reports a provider identity owned by another account', async () => {
    const app = await setup();
    await app.start();
    await app.answer(2, refusal(409, 'OAUTH_ACCOUNT_LINKED_ELSEWHERE'));
    expect(app.subject.current().list?.providers).toEqual(['email']);
    expect(app.subject.current().notice?.key).toBe('providers.elsewhere');
    expect(app.calls).toHaveLength(3);
  });
});
