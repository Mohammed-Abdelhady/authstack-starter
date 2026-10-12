import { describe, expect, it } from 'vitest';
import { createNativeSignInPorts } from '../src/native-sign-in-ports';
import { createPasskeySignInPort } from '../src/ports/passkey-sign-in';
import { TestAbort } from './support/abort';
import {
  createNativeSignInFixture,
  createNativeSignInSettings,
} from './support/native-sign-in-modules';

const OPTIONS = { challenge: 'challenge-value', rpId: 'example.test' };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function readinessFixture() {
  const fixture = createNativeSignInFixture('ios');
  const module = fixture.modules.passkeys;
  if (!module) throw new Error('Missing passkey SDK fixture');
  const support = deferred<boolean>();
  let checks = 0;
  let response: () => boolean | Promise<boolean> = () => support.promise;
  module.isSupported = () => {
    checks += 1;
    return response();
  };
  const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
  return {
    ...fixture,
    ports,
    support,
    get checks() {
      return checks;
    },
    respond: (next: () => boolean | Promise<boolean>) => {
      response = next;
    },
  };
}

async function drain(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

describe('physical passkey readiness lease', () => {
  it('coalesces repeated available calls until the native support promise settles', async () => {
    const fixture = readinessFixture();
    const reads = Array.from({ length: 8 }, () => fixture.ports.passkeys.available());
    await drain();
    const physicalChecks = fixture.checks;
    fixture.support.resolve(true);
    const answers = await Promise.all(reads);
    expect(physicalChecks).toBe(1);
    expect(answers).toEqual([true, true, true, true, true, true, true, true]);
    fixture.respond(() => false);
    expect(await fixture.ports.passkeys.available()).toBe(false);
    expect(fixture.checks).toBe(2);
  });

  it('joins public readiness and authenticate without duplicating the SDK support call', async () => {
    const fixture = readinessFixture();
    const read = fixture.ports.passkeys.available();
    const authentication = fixture.ports.passkeys.authenticate(OPTIONS, new TestAbort().signal);
    await drain();
    const physicalChecks = fixture.checks;
    fixture.support.resolve(true);
    expect(await read).toBe(true);
    expect(await authentication).toEqual({ kind: 'cancelled' });
    expect(physicalChecks).toBe(1);
    expect(fixture.calls.passkeyPromptCount).toBe(1);
  });

  it('retains a hung support check across aborted attempts and never prompts on their late readiness', async () => {
    const fixture = readinessFixture();
    const read = fixture.ports.passkeys.available();
    const requests = Array.from({ length: 8 }, () => {
      const controller = new TestAbort();
      const pending = fixture.ports.passkeys.authenticate(OPTIONS, controller.signal);
      controller.abort();
      return pending;
    });
    await drain();
    const physicalChecks = fixture.checks;
    fixture.support.resolve(true);
    await read;
    const results = await Promise.all(requests);
    expect(physicalChecks).toBe(1);
    expect(results.map(({ kind }) => kind)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(fixture.calls.passkeyPromptCount).toBe(0);
    fixture.respond(() => true);
    expect(await fixture.ports.passkeys.available()).toBe(true);
    expect(fixture.checks).toBe(2);
  });

  it('shares readiness while the existing prompt lease permits only one OS get call', async () => {
    const fixture = readinessFixture();
    const prompt = deferred<unknown>();
    fixture.calls.passkeyResult = () => prompt.promise;
    const first = fixture.ports.passkeys.authenticate(OPTIONS, new TestAbort().signal);
    const second = fixture.ports.passkeys.authenticate(OPTIONS, new TestAbort().signal);
    await drain();
    const physicalChecks = fixture.checks;
    fixture.support.resolve(true);
    await drain();
    const physicalPrompts = fixture.calls.passkeyPromptCount;
    prompt.resolve(null);
    expect(await Promise.all([first, second])).toEqual([
      { kind: 'cancelled' },
      { kind: 'unavailable' },
    ]);
    expect(physicalChecks).toBe(1);
    expect(physicalPrompts).toBe(1);
  });

  it.each(['false', 'reject', 'throw'] as const)(
    'releases actual %s settlement without caching unavailability',
    async (failure) => {
      const fixture = readinessFixture();
      if (failure === 'throw')
        fixture.respond(() => {
          throw new Error('Native bridge unavailable');
        });
      const first = fixture.ports.passkeys.available();
      const second = fixture.ports.passkeys.available();
      const authentication = fixture.ports.passkeys.authenticate(OPTIONS, new TestAbort().signal);
      await drain();
      const physicalChecks = fixture.checks;
      if (failure === 'reject') fixture.support.reject(new Error('Native support failed'));
      else fixture.support.resolve(false);
      expect(await Promise.all([first, second])).toEqual([false, false]);
      expect(await authentication).toEqual({ kind: 'unavailable' });
      expect(physicalChecks).toBe(1);
      expect(fixture.calls.passkeyPromptCount).toBe(0);
      fixture.respond(() => true);
      expect(await fixture.ports.passkeys.available()).toBe(true);
      expect(fixture.checks).toBe(2);
    },
  );

  it('does not start readiness for a pre-aborted authenticate call', async () => {
    const fixture = readinessFixture();
    const controller = new TestAbort();
    controller.abort();
    expect(await fixture.ports.passkeys.authenticate(OPTIONS, controller.signal)).toEqual({
      kind: 'cancelled',
    });
    expect(fixture.checks).toBe(0);
    expect(fixture.calls.passkeyPromptCount).toBe(0);
  });

  it('keeps support reads scoped to each port instance', async () => {
    const fixture = readinessFixture();
    const other = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const reads = [
      fixture.ports.passkeys.available(),
      fixture.ports.passkeys.available(),
      other.passkeys.available(),
      other.passkeys.available(),
    ];
    await drain();
    const physicalChecks = fixture.checks;
    fixture.support.resolve(true);
    expect(await Promise.all(reads)).toEqual([true, true, true, true]);
    expect(physicalChecks).toBe(2);
  });

  it('does not query the SDK without native platform, module or RP configuration', async () => {
    const fixture = readinessFixture();
    const settings = createNativeSignInSettings();
    const module = fixture.modules.passkeys;
    const missing = createPasskeySignInPort('ios', undefined, settings);
    const web = createPasskeySignInPort('web', module, settings);
    const unconfigured = createPasskeySignInPort('ios', module, {
      ...settings,
      passkeyRpId: undefined,
    });
    expect(
      await Promise.all([missing.available(), web.available(), unconfigured.available()]),
    ).toEqual([false, false, false]);
    expect(fixture.checks).toBe(0);
  });
});
