import { describe, expect, it } from 'vitest';
import type { NativePasskeyAssertion, NativePasskeyOptions } from '@app/sdk';
import { createApiClient } from '@app/sdk';
import { AuthRuntime } from '../../src/runtime/runtime';
import { createNativeProofAction } from '../../src/passkeys/native-proof';
import type { NativePromptResult, PasskeyPort } from '../../src';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  testPorts,
} from '../support/support';
import { createAuthEngine } from '../support/engine';

const OPTIONS = '/api/auth/native/proof/options';
const VERIFY = '/api/auth/native/proof/verify';
const ASSERTION: NativePasskeyAssertion = {
  id: 'key',
  rawId: 'key',
  type: 'public-key',
  response: {
    clientDataJSON: 'client',
    authenticatorData: 'authenticator',
    signature: 'signature',
  },
};
const REQUEST: NativePasskeyOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'app.example.test',
  userVerification: 'required',
  allowCredentials: [{ type: 'public-key', id: 'key' }],
};

class Prompt implements PasskeyPort {
  readonly asked: NativePasskeyOptions[] = [];
  readonly started = new Deferred<void>();
  answer: () => Promise<NativePromptResult<NativePasskeyAssertion>> = async () => ({
    kind: 'success',
    value: ASSERTION,
  });
  available = async () => true;
  authenticate = (options: NativePasskeyOptions) => {
    this.asked.push(options);
    this.started.resolve();
    return this.answer();
  };
}

async function signedIn(prompt: Prompt) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, { ...ports, passkeys: prompt });
  await establishSession(engine, ports, transport);
  transport.sent.length = 0;
  return { engine, transport };
}

describe('native session proof', () => {
  it('coalesces presses and passes the server challenge through the prompt to verification', async () => {
    const prompt = new Prompt();
    const { engine, transport } = await signedIn(prompt);
    transport.enqueue(apiReply(REQUEST), apiReply({ provedAt: '2026-10-17T00:00:00Z' }));
    const first = engine.passkeys.prove?.();
    expect(engine.passkeys.prove?.()).toBe(first);
    expect(await first).toBe(true);
    expect(prompt.asked).toEqual([REQUEST]);
    expect(transport.sent.map(({ path }) => path)).toEqual([OPTIONS, VERIFY]);
    expect(transport.sent[1]?.body).toEqual(ASSERTION);
  });

  it('keeps cancellation from verifying an assertion', async () => {
    const prompt = new Prompt();
    prompt.answer = async () => ({ kind: 'cancelled' });
    const { engine, transport } = await signedIn(prompt);
    transport.enqueue(apiReply(REQUEST));
    expect(await engine.passkeys.prove?.()).toBe(false);
    expect(transport.sent.map(({ path }) => path)).toEqual([OPTIONS]);
  });

  it('ends on session change and never verifies the late prompt answer', async () => {
    const prompt = new Prompt();
    const held = new Deferred<NativePromptResult<NativePasskeyAssertion>>();
    prompt.answer = () => held.promise;
    const transport = new ScriptedTransport();
    const runtime = new AuthRuntime(CONFIG, testPorts(transport));
    const prove = createNativeProofAction({
      client: createApiClient(transport),
      port: prompt,
      session: runtime,
    });
    transport.enqueue(apiReply(REQUEST), apiReply({ provedAt: '2026-10-17T00:00:00Z' }));
    const pending = prove();
    await prompt.started.promise;
    runtime.bumpEpoch('signIn');
    expect(await pending).toBe(false);
    held.resolve({ kind: 'success', value: ASSERTION });
    await held.promise;
    await Promise.resolve();
    expect(transport.sent.map(({ path }) => path)).toEqual([OPTIONS]);
    expect(runtime.epochListeners.size).toBe(0);
    runtime.dispose();
  });
});
