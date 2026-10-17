import { describe, expect, it } from 'vitest';
import type { LaunchAddressResult } from '../../src';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  oauthTokenReply,
  redirectFrom,
  successUserReply,
  testPorts,
} from '../support/support';

const SIGN_IN_REQUESTS = ['/api/oauth/token', '/api/user/profile'];

/** An app killed while the browser was open, started again by the link that ends the sign-in. */
async function coldStartFromSignIn() {
  const savedPorts = testPorts(new ScriptedTransport());
  const browserPending = new Deferred<{ kind: 'cancelled' }>();
  const browserOpened = new Deferred<string>();
  savedPorts.authBrowser.results.push(() => browserPending.promise);
  savedPorts.authBrowser.beforeOpen = (address) => browserOpened.resolve(address);
  const first = createAuthEngine(CONFIG, savedPorts);
  await first.restore();
  const firstSignIn = first.signIn();
  const link = redirectFrom(await browserOpened.promise, { code: 'cold-code' });
  const savedTransaction = savedPorts.credentials.value;
  await first.signOut();
  await firstSignIn;
  savedPorts.credentials.value = savedTransaction;
  browserPending.resolve({ kind: 'cancelled' });

  const transport = new ScriptedTransport();
  transport.enqueue(oauthTokenReply(), successUserReply());
  const ports = testPorts(transport);
  ports.credentials = savedPorts.credentials;
  ports.install = savedPorts.install;
  ports.callbacks.initial = link;
  return { transport, ports, link };
}

describe('a launch address that could not be read', () => {
  it('asks again on the next restore and completes the sign-in', async () => {
    const { transport, ports } = await coldStartFromSignIn();
    ports.callbacks.unavailableReads = 1;
    const engine = createAuthEngine(CONFIG, ports);

    const first = await engine.restore();

    expect(first).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(transport.sent).toHaveLength(0);

    const second = await engine.restore();

    expect(second).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(ports.callbacks.initialCalls).toBe(2);
    expect(transport.sent.map(({ path }) => path)).toEqual(SIGN_IN_REQUESTS);
  });

  it('asks again after a read that rejected', async () => {
    const { transport, ports } = await coldStartFromSignIn();
    const read = ports.callbacks.initialAddress.bind(ports.callbacks);
    let attempts = 0;
    ports.callbacks.initialAddress = () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('link read failed')) : read();
    };
    const engine = createAuthEngine(CONFIG, ports);

    await engine.restore();
    const second = await engine.restore();

    expect(second).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(attempts).toBe(2);
    expect(transport.sent.map(({ path }) => path)).toEqual(SIGN_IN_REQUESTS);
  });

  it('takes the answer of a read that passed its deadline, without asking twice', async () => {
    const { transport, ports, link } = await coldStartFromSignIn();
    const answer = new Deferred<LaunchAddressResult>();
    const asked = new Deferred<void>();
    let attempts = 0;
    ports.callbacks.initialAddress = () => {
      attempts += 1;
      asked.resolve();
      return answer.promise;
    };
    const engine = createAuthEngine(CONFIG, ports);
    const first = engine.restore();
    await asked.promise;
    ports.timer.fireDelay(5_000);

    expect(await first).toEqual({ kind: 'restored', status: 'signedOut' });

    answer.resolve({ kind: 'address', address: link });
    const second = await engine.restore();

    expect(second).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(attempts).toBe(1);
    expect(transport.sent.map(({ path }) => path)).toEqual(SIGN_IN_REQUESTS);
  });
});
