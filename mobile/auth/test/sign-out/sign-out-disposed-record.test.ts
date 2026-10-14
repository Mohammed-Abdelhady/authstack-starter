import { describe, expect, it } from 'vitest';
import { CREDENTIAL_DELETE_TIMEOUT_MS } from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import { watchTimerDrain } from '../support/timer-drain';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  establishSession,
  testPorts,
} from '../support/support';

describe('sign out of a session read from storage', () => {
  it('keeps the read session guard when disposal lands before its delete runs', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const firstEngine = createAuthEngine(CONFIG, firstPorts);
    await establishSession(firstEngine, firstPorts, firstTransport);

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = firstPorts.credentials;
    let engine: ReturnType<typeof createAuthEngine> | undefined;
    const originalAfter = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      const cancel = originalAfter(milliseconds, callback);
      if (milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS && engine) {
        const current = engine;
        engine = undefined;
        current.dispose();
      }
      return cancel;
    };
    const revokeCompleted = new Deferred<void>();
    transport.respond = async ({ path }) => {
      if (path !== '/api/oauth/revoke') throw new Error(`Unexpected request: ${path}`);
      return { status: 200, body: {} };
    };
    transport.onResponse = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeCompleted.resolve();
    };
    engine = createAuthEngine(CONFIG, ports);
    const timersDrained = watchTimerDrain(ports.timer);

    await expect(engine.signOut()).resolves.toEqual({ kind: 'disposed' });
    await revokeCompleted.promise;
    await timersDrained();

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
    firstEngine.dispose();
  });
});
