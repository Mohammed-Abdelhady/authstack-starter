import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { apiReply, CONFIG, ScriptedTransport, testPorts } from '../support/support';
import { ATTEMPT_ID, startReply } from './native-fixtures';
import { METHODS } from './native-methods-fixtures';

describe('native flow guards', () => {
  it('sends a first-factor passkey assertion to passkey verification', async () => {
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
      apiReply(METHODS),
      apiReply({ challenge: 'challenge-value', rpId: 'example.test' }),
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

    const result = await engine.nativeSignIn({ kind: 'passkey' });

    expect(result.kind).toBe('continue');
    expect(transport.sent[3].path).toBe('/api/auth/native/attempts/attempt-1/passkey/verify');
    expect(transport.sent[3].body).toEqual({ response: assertion });
    expect(base.credentials.value).not.toContain('signature');
  });

  it('does not report completed recovery without a confirmed password update', async () => {
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
        passwordUpdated: false,
      }),
    );
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'recovery' });
    await engine.nativeSignIn({ kind: 'requestRecovery', email: 'person@example.test' });

    const result = await engine.nativeSignIn({
      kind: 'confirmRecovery',
      input: {
        email: 'person@example.test',
        code: '123456',
        newPassword: 'new-secret',
      },
    });

    expect(result.kind).toBe('apiFailure');
    expect(ports.credentials.value).toContain(ATTEMPT_ID);
    expect(ports.credentials.value).not.toContain('new-secret');
  });
});
