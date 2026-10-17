import { assert, describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  apiReply,
  CONFIG,
  Deferred,
  oauthTokenReply,
  ScriptedTransport,
  successUserReply,
  testPorts,
  USER,
} from '../support/support';
import {
  ATTEMPT_ID,
  ATTEMPT_SECRET,
  startReply,
  secondFactorReply,
  TEMPORARY_PASSWORD,
} from './native-fixtures';

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
      password: TEMPORARY_PASSWORD,
    });

    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/auth/native/attempts',
      '/api/auth/native/attempts/attempt-1/password',
    ]);
    expect(started.kind).toBe('continue');
    expect(answered.kind).toBe('continue');
    expect(persistedBeforeStart).toBe(true);
    expect(persistedBeforePassword).toBe(true);
    expect(ports.credentials.value).not.toContain(TEMPORARY_PASSWORD);
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

  it('does not exchange a code issued after cancellation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const delayed = new Deferred<ReturnType<typeof apiReply>>();
    const sent = new Deferred<void>();
    transport.onRequest = (request) => {
      if (request.path.endsWith('/password')) sent.resolve();
    };
    transport.enqueue(startReply(expiresAt), () => delayed.promise);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const saved = JSON.parse(ports.credentials.value ?? '{}') as {
      transaction?: { state?: string };
    };
    const pending = engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: TEMPORARY_PASSWORD,
    });
    await sent.promise;
    await engine.cancelNativeSignIn();
    delayed.resolve(
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'codeReady',
        expiresAt,
        redirectUri: `${CONFIG.redirectUri}?code=late-code&state=${saved.transaction?.state ?? ''}`,
      }),
    );

    expect((await pending).kind).toBe('signedOut');
    expect(transport.sent.some(({ path }) => path === '/api/oauth/token')).toBe(false);
    expect(engine.snapshot.status).toBe('signedOut');
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
      password: TEMPORARY_PASSWORD,
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

  it('consumes a warm email callback using the saved attempt and state', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(
      startReply(expiresAt),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'emailLinkSent',
        expiresAt,
        email: 'person@example.test',
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
            redirectUri: `${CONFIG.redirectUri}?code=warm-code&state=${saved.transaction?.state ?? ''}`,
          }),
        );
      },
      oauthTokenReply(),
      successUserReply(),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    await engine.nativeSignIn({ kind: 'requestEmailLink', email: 'person@example.test' });
    const saved = JSON.parse(ports.credentials.value ?? '{}') as {
      transaction?: { state?: string };
    };
    const address = `${CONFIG.redirectUri}?native_attempt_id=${ATTEMPT_ID}&native_email_token=warm-token&state=${saved.transaction?.state ?? ''}`;

    await ports.callbacks.deliver(address);

    expect(engine.snapshot.status).toBe('signedIn');
    assert.isDefined(transport.sent[2]);
    expect(transport.sent[2].body).toEqual({
      token: 'warm-token',
      state: saved.transaction?.state,
    });
    expect(ports.credentials.value).not.toContain('warm-token');
  });

  it('rejects a second factor tap and ignores the first result after dispose', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const delayed = new Deferred<ReturnType<typeof secondFactorReply>>();
    const sent = new Deferred<void>();
    transport.onRequest = (request) => {
      if (request.path.endsWith('/password')) sent.resolve();
    };
    transport.enqueue(startReply(expiresAt), () => delayed.promise);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const first = engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: TEMPORARY_PASSWORD,
    });
    await sent.promise;
    const second = await engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: TEMPORARY_PASSWORD,
    });
    engine.dispose();
    delayed.resolve(secondFactorReply(expiresAt));

    expect(second.kind).toBe('busy');
    expect((await first).kind).toBe('disposed');
    expect(transport.sent.filter(({ path }) => path.endsWith('/password'))).toHaveLength(1);
  });
});
