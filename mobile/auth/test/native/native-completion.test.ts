import { assert, describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  apiReply,
  CONFIG,
  failedApiReply,
  oauthTokenReply,
  ScriptedTransport,
  successUserReply,
  testPorts,
  readQueryValues, // feature:locale-ar
} from '../support/support';
import { ATTEMPT_ID, startReply } from './native-fixtures';

describe('native flow completion', () => {
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
    assert.isDefined(transport.sent[2]);
    expect(transport.sent[2].body).toEqual({ token: 'mail-token', state });
    expect(JSON.stringify(cold.snapshot)).not.toContain('mail-token');
  });

  // feature:locale-ar:start
  it('adds validated browser selectors and rejects a contradictory provider flow', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const invalid = await engine.signIn({ providerId: 'google', flow: 'recovery' });
    const valid = await engine.signIn({ providerId: 'google', flow: 'signIn', locale: 'ar' });

    expect(invalid.kind).toBe('browserFailure');
    expect(valid.kind).toBe('cancelled');
    expect(ports.authBrowser.opened).toHaveLength(1);
    assert.isDefined(ports.authBrowser.opened[0]);
    const query = readQueryValues(ports.authBrowser.opened[0].address);
    expect(query.get('provider_id')).toBe('google');
    expect(query.get('flow')).toBe('signIn');
    expect(query.get('locale')).toBe('ar');
  });
  // feature:locale-ar:end

  it('returns signed out only after the recovery server confirms a password update', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(
      startReply(expiresAt),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'recoveryCodeRequired',
        expiresAt,
        email: 'person@example.test',
      }),
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'recoveryComplete',
        expiresAt,
        passwordUpdated: true,
      }),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'recovery' });
    const requested = await engine.nativeSignIn({
      kind: 'requestRecovery',
      email: 'person@example.test',
    });
    const confirmed = await engine.nativeSignIn({
      kind: 'confirmRecovery',
      input: { email: 'person@example.test', code: '123456', newPassword: 'new-secret' },
    });

    expect(requested.kind).toBe('continue');
    expect(confirmed.kind).toBe('recoveryComplete');
    expect(engine.snapshot.status).toBe('signedOut');
    expect(ports.credentials.value).toBeUndefined();
  });

  it('requires consent before exchanging the code and exposes no codeReady view', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    transport.enqueue(
      startReply(expiresAt),
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
      () => {
        const saved = JSON.parse(ports.credentials.value ?? '{}') as {
          transaction?: { state?: string };
        };
        return Promise.resolve(
          apiReply({
            attemptId: ATTEMPT_ID,
            stage: 'codeReady',
            expiresAt,
            redirectUri: `${CONFIG.redirectUri}?code=consent-code&state=${saved.transaction?.state ?? ''}`,
          }),
        );
      },
      oauthTokenReply(),
      successUserReply(),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const factor = await engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'temporary-secret',
    });
    const beforeConsent = transport.sent.length;
    const accepted = await engine.nativeSignIn({ kind: 'consent' });

    expect(factor.kind).toBe('continue');
    expect(factor.kind === 'continue' ? factor.view.stage : '').toBe('consentRequired');
    expect(beforeConsent).toBe(2);
    expect(accepted.kind).toBe('signedIn');
    expect(engine.snapshot.nativeAttempt).toBeUndefined();
  });

  it('restores an MFA stage from the server and completes it without saving the code', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const secondFactor = apiReply({
      attemptId: ATTEMPT_ID,
      stage: 'secondFactorRequired',
      expiresAt,
      factors: ['totp'],
    });
    transport.enqueue(startReply(expiresAt), secondFactor);
    const first = createAuthEngine(CONFIG, ports);
    await first.restore();
    await first.nativeSignIn({ kind: 'start', flow: 'signIn' });
    await first.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'temporary-secret',
    });
    first.dispose();
    transport.enqueue(
      secondFactor,
      () => {
        const saved = JSON.parse(ports.credentials.value ?? '{}') as {
          transaction?: { state?: string };
        };
        return Promise.resolve(
          apiReply({
            attemptId: ATTEMPT_ID,
            stage: 'codeReady',
            expiresAt,
            redirectUri: `${CONFIG.redirectUri}?code=mfa-code&state=${saved.transaction?.state ?? ''}`,
          }),
        );
      },
      oauthTokenReply(),
      successUserReply(),
    );
    const cold = createAuthEngine(CONFIG, ports);
    await cold.restore();

    const result = await cold.nativeSignIn({ kind: 'secondFactor', input: { code: '123456' } });

    expect(result.kind).toBe('signedIn');
    expect(cold.snapshot.status).toBe('signedIn');
    assert.isDefined(transport.sent[2]);
    expect(transport.sent[2].path).toBe('/api/auth/native/attempts/attempt-1');
    expect(ports.credentials.value).not.toContain('123456');
  });

  it('rejects a native email callback sent to a different destination', async () => {
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
    ports.callbacks.initial = `sampleapp://wrong/callback?native_attempt_id=${ATTEMPT_ID}&native_email_token=mail-token&state=${saved.transaction?.state ?? ''}`;
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

    expect(cold.snapshot.status).toBe('signedOut');
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/auth/native/attempts',
      '/api/auth/native/attempts/attempt-1',
    ]);
  });
});
