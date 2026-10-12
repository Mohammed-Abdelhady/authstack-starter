import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  apiReply,
  CONFIG,
  Deferred,
  failedApiReply,
  oauthTokenReply,
  ScriptedTransport,
  successUserReply,
  testPorts,
  USER,
  readQueryValues,
} from '../support/support';

const ATTEMPT_ID = 'attempt-1';
const ATTEMPT_SECRET = 's'.repeat(43);
const NONCE_DIGEST = 'a'.repeat(64);

function startReply(expiresAt: string) {
  return apiReply({
    attemptId: ATTEMPT_ID,
    attemptSecret: ATTEMPT_SECRET,
    providerNonceDigest: NONCE_DIGEST,
    stage: 'firstFactorRequired',
    expiresAt,
    factors: ['password', 'provider', 'passkey', 'emailLink'],
  });
}

function secondFactorReply(expiresAt: string) {
  return apiReply({
    attemptId: ATTEMPT_ID,
    stage: 'secondFactorRequired',
    expiresAt,
    factors: ['totp'],
  });
}

describe('native engine', () => {
  it('saves a fresh attempt before factor submission and keeps inputs out of storage and snapshots', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    let persistedBeforeStart = false;
    let persistedBeforePassword = false;
    transport.respond = async (request) => {
      if (request.path === '/api/auth/native/attempts') {
        persistedBeforeStart = ports.credentials.value?.includes('verifier') === true;
        return startReply(expiresAt);
      }
      persistedBeforePassword = ports.credentials.value?.includes(ATTEMPT_SECRET) === true;
      return secondFactorReply(expiresAt);
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const started = await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const answered = await engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'temporary-secret',
    });

    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/auth/native/attempts',
      '/api/auth/native/attempts/attempt-1/password',
    ]);
    expect(started.kind).toBe('continue');
    expect(answered.kind).toBe('continue');
    expect(persistedBeforeStart).toBe(true);
    expect(persistedBeforePassword).toBe(true);
    expect(ports.credentials.value).not.toContain('temporary-secret');
    expect(JSON.stringify(engine.snapshot)).not.toContain(ATTEMPT_SECRET);
    expect(engine.snapshot.nativeAttempt?.stage).toBe('secondFactorRequired');
  });

  it('ignores a factor reply that lands after cancellation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const delayed = new Deferred<ReturnType<typeof secondFactorReply>>();
    transport.enqueue(startReply(expiresAt), () => delayed.promise);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    expect((await engine.nativeSignIn({ kind: 'start', flow: 'signIn' })).kind).toBe('continue');

    const pending = engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'x',
    });
    const cancelled = await engine.cancelNativeSignIn();
    delayed.resolve(secondFactorReply(expiresAt));
    const late = await pending;

    expect(cancelled.kind).toBe('cancelled');
    expect(late.kind).toBe('signedOut');
    expect(engine.snapshot.nativeAttempt).toBeUndefined();
    expect(ports.credentials.value).toBeUndefined();
  });

  it('reads methods without a bearer and retains system fallback for unavailable SDKs', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    transport.enqueue(
      apiReply({
        nativeEnabled: true,
        methods: {
          password: true,
          magicLink: false,
          twoFactor: false,
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
      }),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const methods = await engine.methods();

    expect(methods.capabilities.passkeys).toBe(false);
    expect(methods.providers).toEqual([{ id: 'google', displayName: 'Google', mode: 'system' }]);
    expect(transport.sent[0].headers?.Authorization).toBeUndefined();
    expect(transport.sent[0].path).toBe('/api/auth/native/methods?clientId=native-client');
  });

  it('rejects a foreign email callback and resumes a saved attempt before a cold callback', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(startReply(expiresAt));
    const first = createAuthEngine(CONFIG, ports);
    await first.restore();
    expect((await first.nativeSignIn({ kind: 'start', flow: 'signIn' })).kind).toBe('continue');
    first.dispose();
    const saved = ports.credentials.value;
    expect(saved).toContain(ATTEMPT_SECRET);
    const stored = JSON.parse(saved ?? '{}') as { transaction?: { state?: string } };
    const state = stored.transaction?.state ?? '';
    ports.callbacks.initial = `${CONFIG.redirectUri}?native_attempt_id=foreign&native_email_token=mail-token&state=${state}`;
    transport.enqueue(
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'emailLinkSent',
        expiresAt,
        email: 'person@example.test',
      }),
    );
    const cold = createAuthEngine(CONFIG, ports);

    await cold.restore();

    expect(cold.snapshot.nativeAttempt?.stage).toBe('emailLinkSent');
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/auth/native/attempts',
      '/api/auth/native/attempts/attempt-1',
    ]);
    expect(JSON.stringify(cold.snapshot)).not.toContain('mail-token');
  });

  it('passes server codeReady through the strict callback exchange and installs a session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(
      startReply(expiresAt),
      () => {
        const saved = JSON.parse(ports.credentials.value ?? '{}') as {
          transaction?: { state?: string };
        };
        return Promise.resolve(
          apiReply({
            attemptId: ATTEMPT_ID,
            stage: 'codeReady',
            expiresAt,
            redirectUri: `${CONFIG.redirectUri}?code=issued-code&state=${saved.transaction?.state ?? ''}`,
          }),
        );
      },
      oauthTokenReply(),
      successUserReply(),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });

    const outcome = await engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'temporary-secret',
    });

    expect(outcome.kind).toBe('signedIn');
    expect(engine.snapshot.status).toBe('signedIn');
    expect(engine.snapshot.profile?.id).toBe(USER.id);
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/auth/native/attempts',
      '/api/auth/native/attempts/attempt-1/password',
      '/api/oauth/token',
      '/api/user/profile',
    ]);
    expect(JSON.stringify(engine.snapshot)).not.toContain('issued-code');
  });

  it('keeps activation completion when a later token exchange fails', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(
      startReply(expiresAt),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'registrationCodeRequired',
        expiresAt,
        email: 'person@example.test',
      }),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'secondFactorRequired',
        expiresAt,
        factors: ['totp'],
        activationCompleted: true,
      }),
      () => {
        const saved = JSON.parse(ports.credentials.value ?? '{}') as {
          transaction?: { state?: string };
        };
        return Promise.resolve(
          apiReply({
            attemptId: ATTEMPT_ID,
            stage: 'codeReady',
            expiresAt,
            redirectUri: `${CONFIG.redirectUri}?code=issued-code&state=${saved.transaction?.state ?? ''}`,
          }),
        );
      },
      failedApiReply(400, 'invalid_grant'),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'registration' });
    await engine.nativeSignIn({ kind: 'register', email: 'person@example.test' });

    const activated = await engine.nativeSignIn({
      kind: 'activate',
      input: {
        email: 'person@example.test',
        code: '123456',
        password: 'new-secret',
        name: 'Person',
      },
    });
    const savedAfterActivation = ports.credentials.value;
    const afterFactor = await engine.nativeSignIn({
      kind: 'secondFactor',
      input: { code: '123456' },
    });

    expect(activated.kind).toBe('activationCompleted');
    expect(savedAfterActivation).toContain('"activationCompleted":true');
    expect(afterFactor.kind).toBe('activationCompleted');
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('consumes a valid cold email callback after authenticated resume', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(startReply(expiresAt));
    const first = createAuthEngine(CONFIG, ports);
    await first.restore();
    await first.nativeSignIn({ kind: 'start', flow: 'signIn' });
    first.dispose();
    const saved = JSON.parse(ports.credentials.value ?? '{}') as {
      transaction?: { state?: string };
    };
    const state = saved.transaction?.state ?? '';
    ports.callbacks.initial = `${CONFIG.redirectUri}?native_attempt_id=${ATTEMPT_ID}&native_email_token=mail-token&state=${state}`;
    transport.enqueue(
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'emailLinkSent',
        expiresAt,
        email: 'person@example.test',
      }),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'codeReady',
        expiresAt,
        redirectUri: `${CONFIG.redirectUri}?code=issued-code&state=${state}`,
      }),
      oauthTokenReply(),
      successUserReply(),
    );
    const cold = createAuthEngine(CONFIG, ports);

    await cold.restore();

    expect(cold.snapshot.status).toBe('signedIn');
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/auth/native/attempts',
      '/api/auth/native/attempts/attempt-1',
      '/api/auth/native/attempts/attempt-1/email-link/verify',
      '/api/oauth/token',
      '/api/user/profile',
    ]);
    expect(transport.sent[2].body).toEqual({ token: 'mail-token', state });
    expect(JSON.stringify(cold.snapshot)).not.toContain('mail-token');
  });

  it('adds validated browser selectors and rejects a contradictory provider flow', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const invalid = await engine.signIn({ providerId: 'google', flow: 'recovery' });
    const valid = await engine.signIn({ providerId: 'google', flow: 'signIn', locale: 'ar' });

    expect(invalid.kind).toBe('browserFailure');
    expect(valid.kind).toBe('cancelled');
    expect(ports.authBrowser.opened).toHaveLength(1);
    const query = readQueryValues(ports.authBrowser.opened[0].address);
    expect(query.get('provider_id')).toBe('google');
    expect(query.get('flow')).toBe('signIn');
    expect(query.get('locale')).toBe('ar');
  });
});
