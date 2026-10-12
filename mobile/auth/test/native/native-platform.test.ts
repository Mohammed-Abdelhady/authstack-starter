import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  apiReply,
  CONFIG,
  Deferred,
  readQueryValues,
  ScriptedTransport,
  testPorts,
} from '../support/support';
import { ATTEMPT_ID, ATTEMPT_SECRET, NONCE_DIGEST, startReply } from './native-fixtures';

function methodsReply() {
  return apiReply({
    nativeEnabled: true,
    methods: {
      password: true,
      magicLink: false,
      twoFactor: true,
      passkeys: true,
      oauth: [{ id: 'google', displayName: 'Google' }],
    },
    capabilities: {
      password: true,
      emailLink: false,
      passkeys: true,
      registration: false,
      recovery: false,
    },
    providers: [
      {
        id: 'google',
        displayName: 'Google',
        mode: 'googleIdentityToken',
        sdk: { kind: 'google', webClientId: 'web-client' },
      },
    ],
  });
}

describe('native platform credentials', () => {
  it('submits only the Google SDK artifact with the saved nonce', async () => {
    const transport = new ScriptedTransport();
    const base = testPorts(transport);
    const expiresAt = new Date(base.clock.wall + 10 * 60_000).toISOString();
    let receivedNonce = '';
    let receivedState = '';
    const ports = {
      ...base,
      providerSignIn: {
        available: async () => true,
        authenticate: async (request: { nonceDigest: string; state: string }) => {
          receivedNonce = request.nonceDigest;
          receivedState = request.state;
          return {
            kind: 'success' as const,
            value: {
              kind: 'googleIdentityToken' as const,
              identityToken: 'real-id-token',
              nonceDigest: request.nonceDigest,
            },
          };
        },
      },
    };
    transport.enqueue(
      startReply(expiresAt),
      methodsReply(),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'secondFactorRequired',
        expiresAt,
        factors: ['totp'],
      }),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });

    const result = await engine.nativeSignIn({ kind: 'provider', providerId: 'google' });

    expect(result.kind).toBe('continue');
    expect(receivedNonce).toBe(NONCE_DIGEST);
    expect(receivedState).toBe(JSON.parse(base.credentials.value ?? '{}').transaction.state);
    expect(transport.sent[2].body).toEqual({
      kind: 'googleIdentityToken',
      identityToken: 'real-id-token',
      nonceDigest: NONCE_DIGEST,
    });
    expect(base.credentials.value).not.toContain('real-id-token');
  });

  it('keeps the attempt open when the provider prompt is cancelled', async () => {
    const transport = new ScriptedTransport();
    const base = testPorts(transport);
    const expiresAt = new Date(base.clock.wall + 10 * 60_000).toISOString();
    const ports = {
      ...base,
      providerSignIn: {
        available: async () => true,
        authenticate: async () => ({ kind: 'cancelled' as const }),
      },
    };
    transport.enqueue(startReply(expiresAt), methodsReply());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });

    const result = await engine.nativeSignIn({ kind: 'provider', providerId: 'google' });

    expect(result.kind).toBe('cancelled');
    expect(engine.snapshot.nativeAttempt?.stage).toBe('firstFactorRequired');
    expect(transport.sent).toHaveLength(2);
    expect(base.credentials.value).toContain(ATTEMPT_ID);
  });

  it('submits a passkey from an MFA stage to the second-factor endpoint', async () => {
    const transport = new ScriptedTransport();
    const base = testPorts(transport);
    const expiresAt = new Date(base.clock.wall + 10 * 60_000).toISOString();
    const assertion = {
      id: 'credential-id',
      rawId: 'raw-id',
      type: 'public-key' as const,
      response: {
        clientDataJSON: 'client-json',
        authenticatorData: 'auth-data',
        signature: 'signature',
      },
    };
    const ports = {
      ...base,
      passkeys: {
        available: async () => true,
        authenticate: async () => ({ kind: 'success' as const, value: assertion }),
      },
    };
    transport.enqueue(
      startReply(expiresAt),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'secondFactorRequired',
        expiresAt,
        factors: ['passkey'],
      }),
      apiReply({ challenge: 'challenge-value', rpId: 'example.test' }),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'consentRequired',
        expiresAt,
        account: { id: 'user-1', email: 'person@example.test', name: 'Person' },
        application: {
          clientId: CONFIG.clientId,
          displayName: 'Sample',
          scopes: ['api'],
          alreadyGranted: false,
        },
      }),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    await engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'temporary-secret',
    });

    const result = await engine.nativeSignIn({ kind: 'passkey' });

    expect(result.kind).toBe('continue');
    expect(transport.sent[3].path).toBe('/api/auth/native/attempts/attempt-1/second-factor');
    expect(transport.sent[3].body).toEqual({ passkeyResponse: assertion });
    expect(transport.sent.some(({ path }) => path === '/api/oauth/token')).toBe(false);
  });

  it('discards a provider artifact returned after cancellation', async () => {
    const transport = new ScriptedTransport();
    const base = testPorts(transport);
    const expiresAt = new Date(base.clock.wall + 10 * 60_000).toISOString();
    const prompt = new Deferred<{
      kind: 'success';
      value: { kind: 'googleIdentityToken'; identityToken: string; nonceDigest: string };
    }>();
    const prompted = new Deferred<void>();
    const ports = {
      ...base,
      providerSignIn: {
        available: async () => true,
        authenticate: () => {
          prompted.resolve();
          return prompt.promise;
        },
      },
    };
    transport.enqueue(startReply(expiresAt), methodsReply());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const pending = engine.nativeSignIn({ kind: 'provider', providerId: 'google' });
    await prompted.promise;
    await engine.cancelNativeSignIn();
    prompt.resolve({
      kind: 'success',
      value: {
        kind: 'googleIdentityToken',
        identityToken: 'late-id-token',
        nonceDigest: NONCE_DIGEST,
      },
    });

    expect((await pending).kind).toBe('signedOut');
    expect(transport.sent.some(({ path }) => path.endsWith('/provider'))).toBe(false);
    expect(base.credentials.value).toBeUndefined();
  });

  it('replaces an active method choice with a fresh PKCE state', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    let starts = 0;
    transport.respond = async (request) => {
      if (request.path === '/api/auth/native/attempts') {
        starts += 1;
        return apiReply({
          attemptId: `attempt-${starts}`,
          attemptSecret: ATTEMPT_SECRET,
          providerNonceDigest: NONCE_DIGEST,
          stage: 'firstFactorRequired',
          expiresAt,
          factors: ['password'],
        });
      }
      return apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt, reason: 'cancelled' });
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const first = await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const firstState = JSON.parse(ports.credentials.value ?? '{}').transaction.state;

    const second = await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const secondState = JSON.parse(ports.credentials.value ?? '{}').transaction.state;

    expect(first.kind).toBe('continue');
    expect(second.kind).toBe('continue');
    expect(starts).toBe(2);
    expect(secondState).not.toBe(firstState);
    expect(engine.snapshot.nativeAttempt?.attemptId).toBe('attempt-2');
    expect(transport.sent.some(({ path }) => path.endsWith('/attempt-1/cancel'))).toBe(true);
  });

  it('removes the pending PKCE record when a start request times out before a late reply', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const delayed = new Deferred<ReturnType<typeof startReply>>();
    const sent = new Deferred<void>();
    transport.onRequest = (request) => {
      if (request.path === '/api/auth/native/attempts') sent.resolve();
    };
    transport.enqueue(() => delayed.promise);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const pending = engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    await sent.promise;
    ports.timer.fireDelay(15_000);

    const outcome = await pending;
    delayed.resolve(startReply(expiresAt));

    expect(outcome.kind).toBe('transportFailure');
    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.nativeAttempt).toBeUndefined();
  });

  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('keeps %s on a fresh system-browser provider fallback', async (locale) => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.respond = async (request) => {
      if (request.path === '/api/auth/native/attempts') return startReply(expiresAt);
      if (request.path.startsWith('/api/auth/native/methods')) return methodsReply();
      return apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt, reason: 'cancelled' });
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const firstState = JSON.parse(ports.credentials.value ?? '{}').transaction.state;

    const result = await engine.nativeSignIn({ kind: 'provider', providerId: 'google', locale });

    expect(result.kind).toBe('cancelled');
    expect(ports.authBrowser.opened).toHaveLength(1);
    const query = readQueryValues(ports.authBrowser.opened[0].address);
    expect(query.get('provider_id')).toBe('google');
    expect(query.get('locale')).toBe(locale);
    expect(query.get('state')).not.toBe(firstState);
    expect(engine.snapshot.nativeAttempt).toBeUndefined();
  });
});
