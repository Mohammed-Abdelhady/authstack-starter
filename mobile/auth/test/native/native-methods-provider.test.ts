import { assert, describe, expect, it } from 'vitest';
import { TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, apiReply, testPorts } from '../support/support';
import { ATTEMPT_ID, startReply } from './native-fixtures';
import { GOOGLE_METHODS, drainMethods } from './native-methods-fixtures';

describe('provider methods read ownership', () => {
  it('starts no prompt if a public completion cancels the joined provider continuation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const held = new Deferred<ReturnType<typeof apiReply>>();
    const expiresAt = new Date(ports.clock.wall + 60_000).toISOString();
    let prompts = 0;
    transport.respond = async (request) => {
      if (request.path.endsWith('/attempts')) return startReply(expiresAt);
      if (request.path.includes('/methods')) return held.promise;
      return apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt, reason: 'cancelled' });
    };
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      providerSignIn: {
        available: async () => true,
        authenticate: async () => {
          prompts += 1;
          return { kind: 'cancelled' };
        },
      },
    });
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const publicCompletion = engine.methods().then(() => engine.cancelNativeSignIn());
    const action = engine.nativeSignIn({ kind: 'provider', providerId: 'google' });
    await drainMethods();
    held.resolve(apiReply(GOOGLE_METHODS));
    await Promise.all([publicCompletion, action]);
    expect(prompts).toBe(0);
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(transport.sent.some(({ path }) => path.endsWith('/provider'))).toBe(false);
    expect(ports.credentials.value).toBeUndefined();
    engine.dispose();
  });

  it('joins an overlapping public GET and checks SDK readiness once before its prompt', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const held = new Deferred<ReturnType<typeof apiReply>>();
    const expiresAt = new Date(ports.clock.wall + 60_000).toISOString();
    let readiness = 0;
    let prompts = 0;
    transport.respond = async (request) =>
      request.path.endsWith('/attempts') ? startReply(expiresAt) : held.promise;
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      providerSignIn: {
        available: async () => {
          readiness += 1;
          return true;
        },
        authenticate: async () => {
          prompts += 1;
          return { kind: 'cancelled' };
        },
      },
    });
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const publicRead = engine.methods();
    const action = engine.nativeSignIn({ kind: 'provider', providerId: 'google' });
    await drainMethods();
    const overlapping = transport.sent.filter(({ path }) => path.includes('/methods')).length;
    held.resolve(apiReply(GOOGLE_METHODS));
    const [catalogue, outcome] = await Promise.all([publicRead, action]);
    expect(overlapping).toBe(1);
    assert.isDefined(catalogue.providers[0]);
    expect(catalogue.providers[0].mode).toBe('googleIdentityToken');
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(readiness).toBe(1);
    expect(prompts).toBe(1);
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });

  it('aborts all joined callers promptly and retains the GET lease after action cancellation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const held = new Deferred<ReturnType<typeof apiReply>>();
    const expiresAt = new Date(ports.clock.wall + 60_000).toISOString();
    let prompts = 0;
    transport.respond = async (request) => {
      if (request.path.endsWith('/attempts')) return startReply(expiresAt);
      if (request.path.includes('/methods')) return held.promise;
      return apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt, reason: 'cancelled' });
    };
    const engine = createAuthEngine(CONFIG, {
      ...ports,
      providerSignIn: {
        available: async () => true,
        authenticate: async () => {
          prompts += 1;
          return { kind: 'cancelled' };
        },
      },
    });
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    let actionKind: string | undefined;
    let readError: unknown;
    const action = engine.nativeSignIn({ kind: 'provider', providerId: 'google' }).then((value) => {
      actionKind = value.kind;
      return value;
    });
    const publicRead = engine.methods().catch((error: unknown) => {
      readError = error;
      return error;
    });
    await drainMethods();
    await engine.cancelNativeSignIn();
    await drainMethods();
    const earlyKind = actionKind;
    const earlyAborted =
      readError instanceof TransportError && readError.reason === TRANSPORT_FAILURE.ABORTED;
    const signalAborted = transport.sent.find(({ path }) => path.includes('/methods'))?.signal
      ?.aborted;
    const retry = engine.methods().catch((error: unknown) => error);
    await drainMethods();
    const retained = transport.sent.filter(({ path }) => path.includes('/methods')).length;
    held.resolve(apiReply(GOOGLE_METHODS));
    await Promise.all([action, publicRead, retry]);
    await drainMethods();
    expect(earlyKind).toBe('signedOut');
    expect(earlyAborted).toBe(true);
    expect(signalAborted).toBe(true);
    expect(retained).toBe(1);
    expect(prompts).toBe(0);
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(transport.sent.some(({ path }) => path.endsWith('/provider'))).toBe(false);
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
    engine.dispose();
  });
});
