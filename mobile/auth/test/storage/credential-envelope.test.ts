import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import {
  PENDING_REVOCATION_MAX_ENTRIES,
  PENDING_REVOCATION_MAX_IDENTIFIER_LENGTH,
  PENDING_REVOCATION_MAX_TOKEN_LENGTH,
} from '../../src/constants';
import { createNativeController } from '../../src/native/native-controller';
import { AuthRuntime } from '../../src/runtime/runtime';
import { createSignInController } from '../../src/sign-in/sign-in';
import { readStoredValue, serializeStoredValue } from '../../src/storage/envelope';
import { endedRevocations } from '../../src/storage/pending-revocations';
import { createRestoreOperation } from '../../src/storage/restore';
import type { PendingRevocation } from '../../src/types/record';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  establishSession,
  testPorts,
} from '../support/support';

async function savedSession() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  await establishSession(createAuthEngine(CONFIG, ports), ports, transport);
  return { value: ports.credentials.value ?? '', install: ports.install };
}

function restoreOn(value: string, install: ReturnType<typeof testPorts>['install']) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  ports.credentials.value = value;
  ports.install = install;
  const runtime = new AuthRuntime(CONFIG, ports);
  const client = createApiClient(runtime.rawTransport);
  const signIn = createSignInController(runtime, client, client);
  const native = createNativeController(runtime, client, client, (options) =>
    signIn.signIn(options),
  );
  return { transport, ports, runtime, restore: createRestoreOperation(runtime, signIn, native) };
}

const WAITING: PendingRevocation = {
  serverBaseAddress: CONFIG.serverBaseAddress,
  environment: CONFIG.environment,
  clientId: CONFIG.clientId,
  installDigest: 'envelope-install',
  lineageId: 'envelope-lineage',
  refreshToken: 'waiting-token',
  attempts: 1,
  nextAttemptAt: 0,
  refreshExpiresAt: null,
};

describe('the stored credential envelope', () => {
  it('reads a value from the earlier format as its session with nothing waiting', async () => {
    const { value } = await savedSession();

    expect(JSON.parse(value)).not.toHaveProperty('version');
    expect(readStoredValue(value)).toMatchObject({
      kind: 'read',
      session: { tokens: { refreshToken: REFRESH_TOKEN } },
      pending: [],
    });
  });

  it('writes the earlier session in the current format once something waits beside it', async () => {
    const { value } = await savedSession();

    const written = serializeStoredValue(value, [WAITING]) ?? '';

    expect(JSON.parse(written)).toMatchObject({ version: 1, pendingRevocations: [WAITING] });
    expect(readStoredValue(written)).toMatchObject({
      kind: 'read',
      session: { tokens: { refreshToken: REFRESH_TOKEN } },
      pending: [WAITING],
    });
  });

  // Case 44: a version this build does not know is never read as the current one.
  it('drops a newer version with its reason and starts signed out', async () => {
    const { value, install } = await savedSession();
    const newer = JSON.stringify({ ...JSON.parse(value), version: 2, pendingRevocations: [] });
    const { transport, ports, runtime, restore } = restoreOn(newer, install);

    expect(readStoredValue(newer)).toEqual({ kind: 'unsupported' });
    await expect(restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });

    expect(runtime.snapshot.status).toBe('signedOut');
    expect(endedRevocations(runtime)).toEqual([{ reason: 'unsupportedVersion' }]);
    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent).toEqual([]);
  });

  it('reads a value whose waiting entry is malformed as unreadable, not as a session', async () => {
    const { value } = await savedSession();
    const malformed = JSON.stringify({
      ...JSON.parse(value),
      version: 1,
      pendingRevocations: [{ ...WAITING, refreshExpiresAt: 1 }],
    });

    expect(readStoredValue(malformed)).toEqual({ kind: 'unreadable' });
  });

  // W4: the stored value is bounded and holds one entry per lineage and per token.
  it('reads a list at the entry bound and fails closed one over it', () => {
    const atBound = waitingValue(PENDING_REVOCATION_MAX_ENTRIES);
    const overBound = waitingValue(PENDING_REVOCATION_MAX_ENTRIES + 1);

    expect(readStoredValue(atBound)).toMatchObject({ kind: 'read', session: undefined });
    expect(readStoredValue(overBound)).toEqual({ kind: 'unreadable' });
  });

  it('reads a token and an identifier at their length bounds and fails closed one over', () => {
    const value = (entry: PendingRevocation) => serializeStoredValue(undefined, [entry]) ?? '';
    const token = (length: number) => 't'.repeat(length);
    const lineage = (length: number) => 'l'.repeat(length);

    expect(
      readStoredValue(
        value({ ...WAITING, refreshToken: token(PENDING_REVOCATION_MAX_TOKEN_LENGTH) }),
      ),
    ).toMatchObject({ kind: 'read' });
    expect(
      readStoredValue(
        value({ ...WAITING, refreshToken: token(PENDING_REVOCATION_MAX_TOKEN_LENGTH + 1) }),
      ),
    ).toEqual({ kind: 'unreadable' });
    expect(
      readStoredValue(
        value({ ...WAITING, lineageId: lineage(PENDING_REVOCATION_MAX_IDENTIFIER_LENGTH) }),
      ),
    ).toMatchObject({ kind: 'read' });
    expect(
      readStoredValue(
        value({ ...WAITING, lineageId: lineage(PENDING_REVOCATION_MAX_IDENTIFIER_LENGTH + 1) }),
      ),
    ).toEqual({ kind: 'unreadable' });
  });

  it('fails closed on two entries for one lineage, and on two entries for one token', () => {
    const sameLineage = serializeStoredValue(undefined, [
      WAITING,
      { ...WAITING, refreshToken: 'another-token' },
    ]);
    const withoutLineage: PendingRevocation = {
      serverBaseAddress: WAITING.serverBaseAddress,
      environment: WAITING.environment,
      clientId: WAITING.clientId,
      installDigest: WAITING.installDigest,
      refreshToken: WAITING.refreshToken,
      attempts: 0,
      nextAttemptAt: 0,
      refreshExpiresAt: null,
    };
    const sameTokenNoLineage = serializeStoredValue(undefined, [
      withoutLineage,
      { ...WAITING, lineageId: 'another-lineage' },
    ]);

    expect(readStoredValue(sameLineage ?? '')).toEqual({ kind: 'unreadable' });
    expect(readStoredValue(sameTokenNoLineage ?? '')).toEqual({ kind: 'unreadable' });
  });
});

/** A pending-only value with `count` entries, each its own lineage and token. */
function waitingValue(count: number): string {
  const entries = Array.from({ length: count }, (_, index): PendingRevocation => ({
    ...WAITING,
    lineageId: `lineage-${index}`,
    refreshToken: `token-${index}`,
  }));
  return serializeStoredValue(undefined, entries) ?? '';
}
