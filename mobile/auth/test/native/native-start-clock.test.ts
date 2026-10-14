import type { NativeFlow } from '@app/sdk';
import { assert, describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, testPorts, apiReply } from '../support/support';
import { ATTEMPT_ID, startReply, TEMPORARY_PASSWORD } from './native-fixtures';

const CREATED_AT = 1_800_000_000_000;
const LOCAL_DEADLINE = 1_800_000_900_000;
const FLOWS: readonly NativeFlow[] = ['signIn', 'registration', 'recovery'];

interface SavedFields {
  transaction?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
}

function isRecord(value: unknown): value is SavedFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function savedTransaction(value: string | undefined): SavedFields {
  const record: unknown = JSON.parse(value ?? '{}');
  if (!isRecord(record) || !isRecord(record.transaction)) {
    throw new Error('Expected a saved transaction');
  }
  return record.transaction;
}

async function startAfterClockChange(flow: NativeFlow, responseAt: number, expiresAt: string) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const response = new Deferred<ReturnType<typeof startReply>>();
  const requested = new Deferred<void>();
  transport.onRequest = (request) => {
    if (request.path === '/api/auth/native/attempts') requested.resolve();
  };
  transport.enqueue(() => response.promise);
  const engine = createAuthEngine(CONFIG, ports);
  await engine.restore();
  const pending = engine.nativeSignIn({ kind: 'start', flow });
  await requested.promise;
  const prepared = savedTransaction(ports.credentials.value);
  ports.clock.jumpWall(responseAt - CREATED_AT);
  response.resolve(startReply(expiresAt));
  const result = await pending;
  return { engine, ports, transport, prepared, result };
}

describe('native attempt creation clock', () => {
  it.each(FLOWS)(
    'accepts a real 15-minute server TTL after a delayed %s start and restores it',
    async (flow) => {
      const { engine, ports, transport, prepared, result } = await startAfterClockChange(
        flow,
        1_800_000_000_100,
        new Date(1_800_000_900_100).toISOString(),
      );

      expect(result.kind).toBe('continue');
      expect(prepared.createdAt).toBe(CREATED_AT);
      assert.isDefined(transport.sent[0]);
      expect(transport.sent[0].body).toEqual({
        clientId: CONFIG.clientId,
        redirectUri: CONFIG.redirectUri,
        codeChallenge: 'T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT08',
        codeChallengeMethod: 'S256',
        state: 'AgICAgICAgICAgICAgICAg',
        scopes: ['api'],
        flow,
      });
      expect(savedTransaction(ports.credentials.value)).toMatchObject({
        createdAt: CREATED_AT,
        expiresAt: LOCAL_DEADLINE,
        state: 'AgICAgICAgICAgICAgICAg',
      });

      engine.dispose();
      transport.enqueue(
        apiReply({
          attemptId: ATTEMPT_ID,
          stage: 'firstFactorRequired',
          expiresAt: new Date(1_800_000_900_100).toISOString(),
          factors: ['password'],
        }),
      );
      const restored = createAuthEngine(CONFIG, ports);
      const outcome = await restored.restore();
      expect(outcome.kind).toBe('restored');
      expect(restored.snapshot.nativeAttempt?.attemptId).toBe(ATTEMPT_ID);
      expect(ports.credentials.value).toContain(ATTEMPT_ID);

      if (flow === 'signIn') {
        transport.enqueue(
          apiReply({
            attemptId: ATTEMPT_ID,
            stage: 'secondFactorRequired',
            expiresAt: new Date(1_800_000_900_100).toISOString(),
            factors: ['totp'],
          }),
        );
        const next = await restored.nativeSignIn({
          kind: 'password',
          email: 'person@example.test',
          password: TEMPORARY_PASSWORD,
        });
        expect(next.kind).toBe('continue');
        assert.isDefined(transport.sent[2]);
        expect(transport.sent[2].path).toBe('/api/auth/native/attempts/attempt-1/password');
      }
      restored.dispose();
    },
  );

  it.each([
    { name: 'shorter server TTL', expiresAt: 1_800_000_600_100, expected: 1_800_000_600_100 },
    { name: 'longer server TTL', expiresAt: 1_800_001_800_100, expected: LOCAL_DEADLINE },
  ])('uses the earlier deadline for $name', async ({ expiresAt, expected }) => {
    const { engine, ports, result } = await startAfterClockChange(
      'signIn',
      1_800_000_000_100,
      new Date(expiresAt).toISOString(),
    );
    expect(result.kind).toBe('continue');
    expect(savedTransaction(ports.credentials.value)).toMatchObject({
      createdAt: CREATED_AT,
      expiresAt: expected,
    });
    engine.dispose();
  });

  it.each([
    { name: 'at the local deadline', responseAt: LOCAL_DEADLINE, expected: 'continue' },
    {
      name: 'one millisecond after the local deadline',
      responseAt: LOCAL_DEADLINE + 1,
      expected: 'expired',
    },
    {
      name: 'after the wall clock moves backward',
      responseAt: CREATED_AT - 1,
      expected: 'expired',
    },
  ])('handles a response $name', async ({ responseAt, expected }) => {
    const { engine, ports, result } = await startAfterClockChange(
      'signIn',
      responseAt,
      new Date(1_800_001_800_100).toISOString(),
    );
    expect(result.kind).toBe(expected);
    if (expected === 'continue') {
      expect(savedTransaction(ports.credentials.value).expiresAt).toBe(LOCAL_DEADLINE);
    } else {
      expect(ports.credentials.value).toBeUndefined();
      expect(engine.snapshot.nativeAttempt).toBeUndefined();
    }
    engine.dispose();
  });

  it.each([
    { name: 'expired', expiresAt: new Date(1_800_000_000_100).toISOString() },
    { name: 'malformed', expiresAt: 'not-a-date' },
  ])('rejects a $name server expiry', async ({ expiresAt }) => {
    const { engine, ports, result } = await startAfterClockChange(
      'registration',
      1_800_000_000_100,
      expiresAt,
    );
    expect(result.kind).toBe('apiFailure');
    expect(ports.credentials.value).toBeUndefined();
    engine.dispose();
  });
});
