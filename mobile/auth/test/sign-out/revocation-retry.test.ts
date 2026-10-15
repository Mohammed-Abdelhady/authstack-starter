import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { AuthRuntime } from '../../src/runtime/runtime';
import { PENDING_REVOCATION_MAX_ENTRIES } from '../../src/constants';
import { createRevocationDrain } from '../../src/sign-out/revocation-retry';
import { withIntent } from '../../src/sign-out/sign-out-record';
import { readStoredValue, serializeStoredValue } from '../../src/storage/envelope';
import {
  endedRevocations,
  holdPendingRevocations,
  recordEndedRevocation,
  updatePendingRevocations,
} from '../../src/storage/pending-revocations';
import type { PendingRevocation } from '../../src/types/record';
import { SoftwareDeviceKey } from '../support/software-device-key';
import { revokedTokens } from '../support/tracking';
import { CONFIG, Deferred, REFRESH_TOKEN, ScriptedTransport, testPorts } from '../support/support';

const LINEAGE_ID = 'retry-lineage';
const OTHER_TOKEN = 'refresh-other';

function waitingOnAll(entries: Partial<PendingRevocation>[], deviceKey?: SoftwareDeviceKey) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport, deviceKey);
  const runtime = new AuthRuntime(CONFIG, ports);
  const pending = entries.map((entry): PendingRevocation => ({
    serverBaseAddress: runtime.config.serverBaseAddress,
    environment: runtime.config.environment,
    clientId: runtime.config.clientId,
    installDigest: 'retry-install',
    lineageId: LINEAGE_ID,
    refreshToken: REFRESH_TOKEN,
    attempts: 0,
    nextAttemptAt: ports.clock.wall,
    refreshExpiresAt: null,
    ...entry,
  }));
  holdPendingRevocations(runtime, pending);
  ports.credentials.value = serializeStoredValue(undefined, pending);
  const drain = createRevocationDrain(runtime, createApiClient(runtime.rawTransport));
  return { transport, ports, runtime, drain, start: ports.clock.wall };
}

function waitingOn(entry: Partial<PendingRevocation>, deviceKey?: SoftwareDeviceKey) {
  return waitingOnAll([entry], deviceKey);
}

function storedPending(value: string | undefined) {
  const read = readStoredValue(value ?? '');
  return read.kind === 'read' ? read.pending : [];
}

describe('pending revocation retries', () => {
  // Case 37: the server sends no refresh lifetime, so the attempt limit ends a token.
  it('drops a revocation past the attempt limit without another call', async () => {
    const { transport, ports, runtime, drain } = waitingOn({ attempts: 6 });

    await drain();

    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.value).toBeUndefined();
    expect(endedRevocations(runtime)).toEqual([{ lineageId: LINEAGE_ID, reason: 'attemptLimit' }]);
  });

  // Case 41: a token bound to a device key that is gone can never be revoked from here.
  it('drops a revocation whose device key is gone and records why', async () => {
    const deviceKey = new SoftwareDeviceKey();
    deviceKey.publicKeyResult = { kind: 'keyInvalidated' };
    const { ports, runtime, drain } = waitingOn({ proofKeyThumbprint: 'gone-key' }, deviceKey);

    await drain();

    expect(ports.credentials.value).toBeUndefined();
    expect(endedRevocations(runtime)).toEqual([{ lineageId: LINEAGE_ID, reason: 'deviceKeyGone' }]);
    expect(ports.timer.pending).toBe(0);
  });

  // Case 43: bounded tries, each failure waits longer, read against the clock.
  it('waits a growing delay between failed tries and makes none before it', async () => {
    const { transport, ports, runtime, drain, start } = waitingOn({});
    transport.enqueue(new Error('offline'));

    await drain();
    expect(storedPending(ports.credentials.value)).toEqual([
      expect.objectContaining({ attempts: 1, nextAttemptAt: start + 30_000 }),
    ]);
    ports.clock.advance(29_999);
    await drain();
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);

    ports.clock.advance(1);
    transport.enqueue(new Error('offline'));
    await drain();

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_TOKEN]);
    expect(storedPending(ports.credentials.value)).toEqual([
      expect.objectContaining({ attempts: 2, nextAttemptAt: start + 30_000 + 120_000 }),
    ]);
    expect(endedRevocations(runtime)).toEqual([]);
    expect(ports.timer.pending).toBe(0);
  });

  // S9: a replaced key is not the bound one, and never will be again.
  it('drops a revocation bound to another key without a request and records why', async () => {
    const { transport, ports, runtime, drain } = waitingOn(
      { proofKeyThumbprint: 'replaced-key' },
      new SoftwareDeviceKey(),
    );

    await drain();

    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.value).toBeUndefined();
    expect(endedRevocations(runtime)).toEqual([{ lineageId: LINEAGE_ID, reason: 'deviceKeyGone' }]);
  });

  // W3: the attempt is stored before it is made; storage that refuses means nothing is sent.
  it('sends nothing and tries one write per round while storage refuses writes', async () => {
    const { transport, ports, runtime, drain } = waitingOn({});
    const stored = ports.credentials.value;
    ports.credentials.writeResult = { kind: 'locked' };

    await drain();
    await drain();
    await drain();

    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.events.filter((event) => event === 'replace:start')).toHaveLength(3);
    expect(ports.credentials.value).toBe(stored);
    expect(endedRevocations(runtime)).toEqual([]);
  });

  // W4: each entry is looked up in the latest list before it is sent.
  it('does not send an entry another step removed while an earlier one was in flight', async () => {
    const { transport, ports, runtime, drain } = waitingOnAll([
      {},
      { lineageId: 'other-lineage', refreshToken: OTHER_TOKEN },
    ]);
    const firstSent = new Deferred<void>();
    const firstAnswer = new Deferred<{ status: number; body: unknown }>();
    transport.onRequest = () => firstSent.resolve();
    transport.enqueue(() => firstAnswer.promise);

    const draining = drain();
    await firstSent.promise;
    await updatePendingRevocations(runtime, (list) =>
      list.filter((entry) => entry.refreshToken !== OTHER_TOKEN),
    );
    firstAnswer.resolve({ status: 200, body: {} });
    await draining;

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
  });

  // W4: a sign-out never stores more than the value may hold; the oldest entry makes room.
  it('drops the oldest waiting entry when a new intent would pass the bound', () => {
    const { ports } = waitingOn({});
    const base = storedPending(ports.credentials.value)[0];
    expect(base).toBeDefined();
    if (base === undefined) return;
    const full = Array.from(
      { length: PENDING_REVOCATION_MAX_ENTRIES },
      (_, index): PendingRevocation => ({
        ...base,
        lineageId: `lineage-${index}`,
        refreshToken: `token-${index}`,
      }),
    );
    const intent: PendingRevocation = { ...base, lineageId: 'newest', refreshToken: 'newest' };

    const { next, dropped } = withIntent(full, intent);

    expect(next).toHaveLength(PENDING_REVOCATION_MAX_ENTRIES);
    expect(dropped.map((entry) => entry.refreshToken)).toEqual(['token-0']);
    expect(next.at(-1)?.refreshToken).toBe('newest');
  });

  // W5: the engine keeps only the latest ended revocations.
  it('keeps the latest sixteen ended revocations and drops the oldest', () => {
    const { runtime } = waitingOn({});
    for (let index = 0; index < 17; index += 1)
      recordEndedRevocation(runtime, 'revoked', `lineage-${index}`);

    const ended = endedRevocations(runtime);
    expect(ended).toHaveLength(16);
    expect(ended[0]).toEqual({ lineageId: 'lineage-1', reason: 'revoked' });
    expect(ended[15]).toEqual({ lineageId: 'lineage-16', reason: 'revoked' });
  });

  // Case 43: the server answers an already revoked token as revoked, which removes it.
  it('removes a revocation the server confirms', async () => {
    const { transport, ports, runtime, drain } = waitingOn({ attempts: 3 });
    transport.enqueue({ status: 200, body: {} });

    await drain();

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(endedRevocations(runtime)).toEqual([{ lineageId: LINEAGE_ID, reason: 'revoked' }]);
  });
});
