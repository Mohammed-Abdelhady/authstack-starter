import type { NativePasskeyOptions, NativeProviderMethod } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createNativeSignInPorts } from '../src/native-sign-in-ports';
import { TestAbort } from './support/abort';
import {
  createNativeSignInFixture,
  createNativeSignInSettings,
} from './support/native-sign-in-modules';

const GOOGLE_METHOD: NativeProviderMethod = {
  id: 'google',
  displayName: 'Google',
  mode: 'googleIdentityToken',
  sdk: { kind: 'google', webClientId: 'web.apps.googleusercontent.com' },
};
const PASSKEY_OPTIONS: NativePasskeyOptions = {
  challenge: 'challenge-value',
  rpId: 'example.test',
};
const NONCE_DIGEST = 'a'.repeat(64);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('native prompt lease', () => {
  it('does not start a provider prompt for an already-aborted request', async () => {
    const fixture = createNativeSignInFixture('android');
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const controller = new TestAbort();
    controller.abort();

    expect(
      await ports.providerSignIn.authenticate(
        { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
        controller.signal,
      ),
    ).toEqual({ kind: 'cancelled' });
    expect(fixture.calls.googlePromptCount).toBe(0);
  });

  it('keeps the physical sheet lease until the SDK promise settles after abort', async () => {
    const fixture = createNativeSignInFixture('android');
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const sdkResult = deferred<unknown>();
    const promptStarted = deferred<void>();
    fixture.calls.googleResult = () => {
      promptStarted.resolve(undefined);
      return sdkResult.promise;
    };

    const providerAbort = new TestAbort();
    const providerCall = ports.providerSignIn.authenticate(
      { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
      providerAbort.signal,
    );
    await promptStarted.promise;
    providerAbort.abort();
    expect(await providerCall).toEqual({ kind: 'cancelled' });

    expect(await ports.passkeys.authenticate(PASSKEY_OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'unavailable',
    });
    expect(fixture.calls.passkeyPromptCount).toBe(0);

    sdkResult.resolve({
      type: 'success',
      data: { idToken: 'late-token', user: { id: 'late-local-user' } },
    });
    await sdkResult.promise;

    fixture.calls.passkeyResult = async () => null;
    expect(await ports.passkeys.authenticate(PASSKEY_OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'cancelled',
    });
    expect(fixture.calls.passkeyPromptCount).toBe(1);
  });
});
