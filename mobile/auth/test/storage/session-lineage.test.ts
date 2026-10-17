import {
  REFRESH_FIRST_TOKEN,
  REFRESH_NEXT_TOKEN,
  REFRESH_RESTORED_NEXT_TOKEN,
  REFRESH_LEGACY_TOKEN,
  REFRESH_WRITTEN_TOKEN,
} from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_DELETE_TIMEOUT_MS, CRYPTO_RANDOM_TIMEOUT_MS } from '../../src/constants';
import { parseStoredRecord } from '../../src/storage/persistence';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  acceptCode,
  establishSession,
  oauthTokenReply,
  redirectFrom,
  successUserReply,
  testPorts,
} from '../support/support';

const EXPECTED_LINEAGE_ID = 'BAQEBAQEBAQEBAQEBAQEBA';

describe('session lineage', () => {
  it('creates one lineage at exchange and carries it through refresh without sending it', async () => {
    const transport = new ScriptedTransport();
    transport.respond = async ({ path, body }) => {
      if (path === '/api/oauth/token') {
        if (JSON.stringify(body).includes('authorization_code'))
          return oauthTokenReply('access-first', REFRESH_FIRST_TOKEN);
        return oauthTokenReply('access-next', REFRESH_NEXT_TOKEN);
      }
      if (path === '/api/user/profile') return successUserReply();
      throw new Error(`Unexpected request: ${path}`);
    };
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    acceptCode(ports.authBrowser);

    expect((await engine.signIn()).kind).toBe('signedIn');
    expect(ports.credentials.value).toContain(`"lineageId":"${EXPECTED_LINEAGE_ID}"`);
    expect(JSON.stringify(transport.sent)).not.toContain('"lineageId"');
    ports.clock.advance(270_000);

    await engine.transport.request({ method: 'GET', path: '/api/user/profile' });

    expect(ports.credentials.value).toContain(`"lineageId":"${EXPECTED_LINEAGE_ID}"`);
    expect(ports.credentials.value).toContain(REFRESH_NEXT_TOKEN);
    expect(JSON.stringify(transport.sent)).not.toContain('"lineageId"');
    expect(ports.timer.pending).toBe(0);
  });

  it('carries the stored lineage through restore and the next rotation', async () => {
    const firstTransport = new ScriptedTransport();
    const ports = testPorts(firstTransport);
    const firstEngine = createAuthEngine(CONFIG, ports);
    await establishSession(firstEngine, ports, firstTransport, 'access-first', REFRESH_FIRST_TOKEN);
    firstEngine.dispose();

    const restoredTransport = new ScriptedTransport();
    restoredTransport.respond = async ({ path }) => {
      if (path === '/api/oauth/token')
        return oauthTokenReply('access-restored-next', REFRESH_RESTORED_NEXT_TOKEN);
      if (path === '/api/user/profile') return successUserReply();
      throw new Error(`Unexpected request: ${path}`);
    };
    ports.makeTransport = () => restoredTransport;
    const restored = createAuthEngine(CONFIG, ports);

    await expect(restored.restore()).resolves.toMatchObject({
      kind: 'restored',
      status: 'signedIn',
    });
    await restored.transport.request({ method: 'GET', path: '/api/user/profile' });

    expect(ports.credentials.value).toContain(`"lineageId":"${EXPECTED_LINEAGE_ID}"`);
    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_RESTORED_NEXT_TOKEN}"`);
    expect(JSON.stringify(restoredTransport.sent)).not.toContain('lineageId');
    expect(ports.timer.pending).toBe(0);
    restored.dispose();
  });

  it.each(['rejected', 'short', 'deadline'] as const)(
    'reports a callback lineage entropy %s as a crypto failure',
    async (failure) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const lineageStarted = new Deferred<void>();
      const hangingBytes = new Deferred<Uint8Array>();
      let call = 0;
      ports.crypto.randomBytes = async (length) => {
        call += 1;
        if (call < 4) return new Uint8Array(length).fill(call);
        lineageStarted.resolve();
        if (failure === 'rejected') throw new Error('entropy port failed');
        if (failure === 'short') return new Uint8Array(length - 1);
        return hangingBytes.promise;
      };
      const engine = createAuthEngine(CONFIG, ports);
      await engine.restore();
      acceptCode(ports.authBrowser);

      const pending = engine.signIn();
      if (failure === 'deadline') {
        await lineageStarted.promise;
        ports.timer.fireDelay(CRYPTO_RANDOM_TIMEOUT_MS);
      }
      const outcome = await pending;

      expect(outcome.kind).toBe('cryptoFailure');
      expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
      expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(0);
      expect(ports.credentials.value).toBeUndefined();
      expect(ports.timer.pending).toBe(0);
      engine.dispose();
    },
  );

  it('requires a lineage before restoring a token record', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const original = createAuthEngine(CONFIG, ports);
    await establishSession(original, ports, transport, 'access-legacy', REFRESH_LEGACY_TOKEN);
    original.dispose();
    ports.credentials.value = ports.credentials.value?.replace(/"lineageId":"[^"]+",/, '');
    const legacy = parseStoredRecord(ports.credentials.value ?? '');
    expect(legacy).toMatchObject({ tokens: { refreshToken: REFRESH_LEGACY_TOKEN } });
    expect(legacy?.lineageId).toBeUndefined();
    const engine = createAuthEngine(CONFIG, ports);

    await expect(engine.restore()).resolves.toMatchObject({
      kind: 'restored',
      status: 'reauthRequired',
    });

    expect(engine.snapshot).toMatchObject({ status: 'reauthRequired', operation: 'none' });
    expect(ports.credentials.value).toContain(REFRESH_LEGACY_TOKEN);
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });

  it('keeps a saved token when disposal follows its storage write and sign-in reports disposed', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const recordWritten = new Deferred<void>();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/token')
        return oauthTokenReply('access-written', REFRESH_WRITTEN_TOKEN);
      if (path === '/api/user/profile') return successUserReply();
      throw new Error(`Unexpected request: ${path}`);
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const ownershipReads = new Deferred<void>();
    const deleteDeadlineCancelled = new Deferred<void>();
    let completedReads = 0;
    ports.credentials.afterRead = () => {
      completedReads += 1;
      if (completedReads === 2) ownershipReads.resolve();
    };
    ports.credentials.afterReplace = (value) => {
      if (value.includes(REFRESH_WRITTEN_TOKEN)) recordWritten.resolve();
    };
    ports.timer.onCancel = (milliseconds) => {
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS) deleteDeadlineCancelled.resolve();
    };
    ports.authBrowser.results.push((address) => ({
      kind: 'redirect',
      url: redirectFrom(address, { code: 'code-written' }),
    }));

    const signIn = engine.signIn();
    await recordWritten.promise;
    engine.dispose();

    await expect(signIn).resolves.toEqual({ kind: 'disposed' });
    await ownershipReads.promise;
    await deleteDeadlineCancelled.promise;

    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_WRITTEN_TOKEN}"`);
    expect(ports.timer.pendingDelays).toEqual([]);
  });
});
