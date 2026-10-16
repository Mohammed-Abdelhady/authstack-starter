import { describe, expect, it } from 'vitest';
import {
  TransportError,
  createApiClient,
  type PasskeyAttestation,
  type PasskeyCreationOptions,
} from '@app/sdk';
import type { AbortSignalPort, NativeRegistrationResult, PasskeyPort } from '../../src';
import { createPasskeyActions } from '../../src/passkeys/passkey-actions';
import { AuthRuntime } from '../../src/runtime/runtime';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  refreshToken,
  testPorts,
} from '../support/support';
import { createAuthEngine } from '../support/engine';

const OPTIONS_PATH = '/api/auth/native/passkeys/register/options';
const VERIFY_PATH = '/api/auth/native/passkeys/register/verify';

/** What the server sends, with a field the prompt does not take. */
const SERVER_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'app.example.test', name: 'Sample' },
  user: { id: 'dXNlci0x', name: 'person@example.test', displayName: 'Test Person' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [{ type: 'public-key', id: 'b2xkLWtleQ', transports: ['internal'] }],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  attestation: 'none',
  hints: [],
};

/** The same options as the prompt receives them, written out by hand. */
const PROMPT_OPTIONS: PasskeyCreationOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'app.example.test', name: 'Sample' },
  user: { id: 'dXNlci0x', name: 'person@example.test', displayName: 'Test Person' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [{ type: 'public-key', id: 'b2xkLWtleQ', transports: ['internal'] }],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  attestation: 'none',
};

const ATTESTATION: PasskeyAttestation = {
  id: 'bmV3LWtleQ',
  rawId: 'bmV3LWtleQ',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'o2NmbXQ', transports: ['internal'] },
};

const SUMMARY = {
  id: 'passkey-1',
  name: 'Phone',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
};

/** The device's passkey prompt, answering what the case says. */
class ScriptedPrompt implements PasskeyPort {
  readonly asked: PasskeyCreationOptions[] = [];
  readonly signals: AbortSignalPort[] = [];
  supported = true;
  answer: () => Promise<NativeRegistrationResult<PasskeyAttestation>> = async () => ({
    kind: 'success',
    value: ATTESTATION,
  });

  available = async () => this.supported;
  authenticate = async () => ({ kind: 'cancelled' as const });
  register = async (options: PasskeyCreationOptions, signal: AbortSignalPort) => {
    this.asked.push(options);
    this.signals.push(signal);
    return this.answer();
  };
}

async function signedIn(prompt: ScriptedPrompt) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, { ...ports, passkeys: prompt });
  await establishSession(engine, ports, transport);
  transport.sent.length = 0;
  const paths = () => transport.sent.map((request) => request.path);
  return { engine, transport, paths };
}

describe('engine.passkeys.register', () => {
  it('asks for options, runs one prompt with them and verifies once: created', async () => {
    const prompt = new ScriptedPrompt();
    const { engine, transport, paths } = await signedIn(prompt);
    transport.enqueue(apiReply(SERVER_OPTIONS), apiReply(SUMMARY));

    const outcome = await engine.passkeys.register('Phone');

    expect(outcome).toEqual({ kind: 'created', passkey: SUMMARY });
    expect(paths()).toEqual([OPTIONS_PATH, VERIFY_PATH]);
    expect(prompt.asked).toEqual([PROMPT_OPTIONS]);
    expect(transport.sent[1]?.body).toEqual({ response: ATTESTATION, name: 'Phone' });
  });

  it('sends nothing to verify when the person cancels the prompt', async () => {
    const prompt = new ScriptedPrompt();
    prompt.answer = async () => ({ kind: 'cancelled' });
    const { engine, transport, paths } = await signedIn(prompt);
    transport.enqueue(apiReply(SERVER_OPTIONS));

    expect(await engine.passkeys.register()).toEqual({ kind: 'cancelled' });
    expect(paths()).toEqual([OPTIONS_PATH]);
  });

  it('answers not supported on a device without passkeys and calls neither the server nor the prompt', async () => {
    const prompt = new ScriptedPrompt();
    prompt.supported = false;
    const { engine, paths } = await signedIn(prompt);

    expect(await engine.passkeys.available()).toBe(false);
    expect(await engine.passkeys.register()).toEqual({ kind: 'notSupported' });
    expect(paths()).toEqual([]);
    expect(prompt.asked).toEqual([]);
  });

  it('answers sign in again when the server asks for a fresh sign-in, and opens no prompt', async () => {
    const prompt = new ScriptedPrompt();
    const { engine, transport } = await signedIn(prompt);
    // The bearer transport refreshes once on any 401 and repeats the call.
    transport.enqueue(
      failedApiReply(401, 'REAUTH_REQUIRED'),
      oauthTokenReply('access-secret-1', refreshToken('secret-1')),
      failedApiReply(401, 'REAUTH_REQUIRED'),
    );

    expect(await engine.passkeys.register()).toEqual({ kind: 'signInAgain' });
    expect(prompt.asked).toEqual([]);
  });

  it('tells an authenticator that already holds the account`s passkey apart from a failure', async () => {
    const prompt = new ScriptedPrompt();
    prompt.answer = async () => ({ kind: 'excluded' });
    const { engine, transport, paths } = await signedIn(prompt);
    transport.enqueue(apiReply(SERVER_OPTIONS));

    expect(await engine.passkeys.register()).toEqual({ kind: 'alreadyRegistered' });
    expect(paths()).toEqual([OPTIONS_PATH]);
  });

  it('answers failed when verify gets no response, and the next attempt starts afresh', async () => {
    const prompt = new ScriptedPrompt();
    const { engine, transport, paths } = await signedIn(prompt);
    transport.enqueue(apiReply(SERVER_OPTIONS), new TransportError());

    expect(await engine.passkeys.register()).toEqual({ kind: 'failed' });

    transport.enqueue(apiReply(SERVER_OPTIONS), apiReply(SUMMARY));
    expect(await engine.passkeys.register()).toEqual({ kind: 'created', passkey: SUMMARY });
    expect(paths()).toEqual([OPTIONS_PATH, VERIFY_PATH, OPTIONS_PATH, VERIFY_PATH]);
  });

  it('answers a second call during a registration with the first one`s outcome, from one prompt', async () => {
    const prompt = new ScriptedPrompt();
    const held = new Deferred<NativeRegistrationResult<PasskeyAttestation>>();
    prompt.answer = () => held.promise;
    const { engine, transport, paths } = await signedIn(prompt);
    transport.enqueue(apiReply(SERVER_OPTIONS), apiReply(SUMMARY));

    const first = engine.passkeys.register('Phone');
    const second = engine.passkeys.register('Other name');
    held.resolve({ kind: 'success', value: ATTESTATION });

    expect(await second).toEqual({ kind: 'created', passkey: SUMMARY });
    expect(await first).toEqual({ kind: 'created', passkey: SUMMARY });
    expect(prompt.asked).toHaveLength(1);
    expect(paths()).toEqual([OPTIONS_PATH, VERIFY_PATH]);
  });

  it('ends the prompt on sign-out and never sends its late attestation on another session', async () => {
    const prompt = new ScriptedPrompt();
    const opened = new Deferred<void>();
    const held = new Deferred<NativeRegistrationResult<PasskeyAttestation>>();
    prompt.answer = () => {
      opened.resolve();
      return held.promise;
    };
    const { engine, transport, paths } = await signedIn(prompt);
    // The options, then the revocation sign-out sends.
    transport.enqueue(apiReply(SERVER_OPTIONS), { status: 200, body: {} });

    const registering = engine.passkeys.register();
    await opened.promise;
    await engine.signOut();
    held.resolve({ kind: 'success', value: ATTESTATION });

    expect(await registering).toEqual({ kind: 'signInAgain' });
    expect(prompt.signals[0]?.aborted).toBe(true);
    expect(paths()).not.toContain(VERIFY_PATH);
  });
});

describe('passkey actions over a port that throws', () => {
  it('answers failed for a register that throws before it returns, and leaves no epoch listener', async () => {
    const transport = new ScriptedTransport();
    const runtime = new AuthRuntime(CONFIG, testPorts(transport));
    const listenersBefore = runtime.epochListeners.size;
    const throwing: PasskeyPort = {
      available: async () => true,
      authenticate: async () => ({ kind: 'cancelled' }),
      register: () => {
        throw new Error('the native module is missing');
      },
    };
    const actions = createPasskeyActions({
      client: createApiClient(transport),
      port: throwing,
      session: runtime,
    });
    transport.enqueue(apiReply(SERVER_OPTIONS));

    expect(await actions.register()).toEqual({ kind: 'failed' });
    expect(runtime.epochListeners.size).toBe(listenersBefore);
  });

  it('reads an availability check that throws before it returns as not supported', async () => {
    const transport = new ScriptedTransport();
    const runtime = new AuthRuntime(CONFIG, testPorts(transport));
    const actions = createPasskeyActions({
      client: createApiClient(transport),
      port: {
        available: () => {
          throw new Error('the native module is missing');
        },
        authenticate: async () => ({ kind: 'cancelled' }),
        register: async () => ({ kind: 'cancelled' }),
      },
      session: runtime,
    });

    expect(await actions.available()).toBe(false);
    expect(await actions.register()).toEqual({ kind: 'notSupported' });
    expect(transport.sent).toEqual([]);
  });
});
