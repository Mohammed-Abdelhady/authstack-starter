import { describe, expect, it } from 'vitest';
import {
  BROWSER_AUTHORIZATION_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  SIGN_OUT_REVOKE_TIMEOUT_MS,
} from '../../src/constants';
import { expectOnlyPendingRevocation } from '../support/pending-revocation';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  acceptCode,
  establishSession,
  testPorts,
} from '../support/support';
import type { SignOutOutcome } from '../../src';

describe('synchronous port failures', () => {
  it('treats a synchronous storage read throw as unavailable storage', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.read = () => {
      throw new Error('read failed');
    };
    const engine = createAuthEngine(CONFIG, ports);

    const result = await engine.restore();

    expect(result).toEqual({ kind: 'storageBlocked', reason: 'unavailable' });
    expect(engine.snapshot.operation).toBe('none');
  });

  it('treats a synchronous identity throw as unavailable install storage', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.install.identity = () => {
      throw new Error('identity failed');
    };
    const engine = createAuthEngine(CONFIG, ports);

    const result = await engine.restore();

    expect(result).toEqual({ kind: 'storageBlocked', reason: 'installUnavailable' });
  });

  it('ignores a synchronous cold-start callback read failure', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.callbacks.initialAddress = () => {
      throw new Error('link read failed');
    };
    const engine = createAuthEngine(CONFIG, ports);

    const result = await engine.restore();

    expect(result).toEqual({ kind: 'restored', status: 'signedOut' });
  });

  it('maps a synchronous randomness throw to crypto failure', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.crypto.randomBytes = () => {
      throw new Error('random failed');
    };

    const result = await engine.signIn();

    expect(result).toMatchObject({ kind: 'cryptoFailure' });
    expect(engine.snapshot.operation).toBe('none');
  });

  it('maps a synchronous digest throw to crypto failure', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.crypto.sha256 = () => {
      throw new Error('digest failed');
    };

    const result = await engine.signIn();

    expect(result).toMatchObject({ kind: 'cryptoFailure' });
    expect(engine.snapshot.operation).toBe('none');
  });

  it('settles sign-in when authorization address encoding rejects a lone surrogate', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine({ ...CONFIG, clientId: 'bad\ud800id' }, ports);
    await engine.restore();

    const result = await engine.signIn();

    expect(result).toMatchObject({ kind: 'browserFailure' });
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });

  it('maps a synchronous credential replace throw to storage failure', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.credentials.replace = () => {
      throw new Error('write failed');
    };
    acceptCode(ports.authBrowser);

    const result = await engine.signIn();

    expect(result.kind).toBe('storageFailure');
    expect(engine.snapshot).toMatchObject({ status: 'storageBlocked', operation: 'none' });
  });

  it('settles sign-out after a synchronous credential delete throw', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.credentials.delete = () => {
      throw new Error('delete failed');
    };

    const result = await engine.signOut();

    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'notNeeded' });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.name).toBe('Error');
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  it('settles restore when the timer port throws while scheduling a deadline', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.timer.after = () => {
      throw new Error('timer failed');
    };
    const engine = createAuthEngine(CONFIG, ports);

    const result = await engine.restore();

    expect(result.kind).toBe('storageBlocked');
    expect(engine.snapshot.operation).toBe('none');
  });

  it('does not open the browser when its deadline cannot be scheduled', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const schedule = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === BROWSER_AUTHORIZATION_TIMEOUT_MS)
        throw new Error('browser timer failed');
      return schedule(milliseconds, callback);
    };

    const result = await engine.signIn();

    expect(result).toMatchObject({ kind: 'browserFailure', reason: 'browser timer failed' });
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.operation).toBe('none');
  });

  it('settles sign-out without sending an unbounded revoke when timer setup throws', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const schedule = ports.timer.after.bind(ports.timer);
    // The write deadline has the same length and is armed first; only the revoke's timer fails.
    expect(CREDENTIAL_WRITE_TIMEOUT_MS).toBe(SIGN_OUT_REVOKE_TIMEOUT_MS);
    let armed = 0;
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === SIGN_OUT_REVOKE_TIMEOUT_MS) {
        armed += 1;
        if (armed === 2) throw new Error('revoke timer failed');
      }
      return schedule(milliseconds, callback);
    };

    const result = await engine.signOut();

    expect(result).toMatchObject({ kind: 'signedOut', revocation: 'failed' });
    expect(result.error?.constructor).toBe(Error);
    expect(transport.sent.some(({ path }) => path === '/api/oauth/revoke')).toBe(false);
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    await expectOnlyPendingRevocation(ports, {
      refreshToken: REFRESH_TOKEN,
      attempts: 1,
      bound: false,
    });
  });

  it('reports a sign-out whose write deadline cannot be armed as not saved', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const saved = ports.credentials.value;
    const eventsBefore = ports.credentials.events.length;
    const schedule = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS) throw new Error('write timer failed');
      return schedule(milliseconds, callback);
    };

    const result = await engine.signOut();

    // An unbounded write is never started, so nothing changed on the device.
    expect(result).toMatchObject({ kind: 'signOutNotSaved' });
    expect(result.error?.message).toBe('write timer failed');
    expect(ports.credentials.value).toBe(saved);
    expect(ports.credentials.events.slice(eventsBefore)).toEqual([]);
    expect(transport.sent.some(({ path }) => path === '/api/oauth/revoke')).toBe(false);
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
  });

  it('settles sign-out when cancelling the browser timer throws', async () => {
    const ports = testPorts(new ScriptedTransport());
    const opened = new Deferred<void>();
    const browser = new Deferred<{ kind: 'cancelled' }>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    ports.authBrowser.results.push(() => browser.promise);
    const schedule = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      const cancel = schedule(milliseconds, callback);
      if (milliseconds !== BROWSER_AUTHORIZATION_TIMEOUT_MS) return cancel;
      return () => {
        cancel();
        throw new Error('cancel failed');
      };
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    await opened.promise;
    let signOut: Promise<SignOutOutcome> | undefined;
    let synchronousFailure: unknown;
    try {
      signOut = engine.signOut();
    } catch (error) {
      synchronousFailure = error;
    }
    browser.resolve({ kind: 'cancelled' });
    await signIn;
    if (signOut) await signOut;

    expect(synchronousFailure).toBeUndefined();
    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.operation).toBe('none');
    expect(ports.timer.pending).toBe(0);
  });

  it('returns a clock failure outcome when wall time throws while saving sign-in', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.clock.wallTime = () => {
      throw new Error('clock failed');
    };

    const result = await engine.signIn().then(
      (value) => ({ kind: 'resolved' as const, value }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    engine.dispose();

    expect(result).toMatchObject({ kind: 'resolved', value: { kind: 'clockFailure' } });
  });
});
