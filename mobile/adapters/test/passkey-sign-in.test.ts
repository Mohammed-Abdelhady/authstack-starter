import type { NativePasskeyOptions } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createNativeSignInPorts } from '../src/native-sign-in-ports';
import { TestAbort } from './support/abort';
import {
  createNativeSignInFixture,
  createNativeSignInSettings,
} from './support/native-sign-in-modules';

const OPTIONS: NativePasskeyOptions = {
  challenge: 'challenge-value',
  rpId: 'example.test',
  timeout: 45000,
  allowCredentials: [{ type: 'public-key', id: 'credential-id', transports: ['internal'] }],
  userVerification: 'required',
};
const ASSERTION = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    clientDataJSON: 'client-data',
    authenticatorData: 'authenticator-data',
    signature: 'signature',
    userHandle: null,
  },
  clientExtensionResults: { credProps: { rk: true } },
};

describe('native passkey sign-in port', () => {
  it('reports unavailable when the optional passkey module is absent', async () => {
    const ports = createNativeSignInPorts({ platform: 'ios' }, createNativeSignInSettings());
    expect(await ports.passkeys.available()).toBe(false);
    expect(await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'unavailable',
    });
  });

  it('preserves request options and returns only a validated assertion', async () => {
    const fixture = createNativeSignInFixture('ios');
    fixture.calls.passkeyResult = async () => ASSERTION;
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const result = await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal);

    expect(fixture.calls.passkeyOptions).toEqual({
      challenge: OPTIONS.challenge,
      rpId: OPTIONS.rpId,
      timeout: OPTIONS.timeout,
      allowCredentials: [{ type: 'public-key', id: 'credential-id', transports: ['internal'] }],
      userVerification: 'required',
    });
    expect(result).toEqual({ kind: 'success', value: ASSERTION });
  });

  it('does not prompt when unsupported or when the server rpId differs from the app setting', async () => {
    const fixture = createNativeSignInFixture('android');
    fixture.calls.passkeySupported = false;
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    expect(await ports.passkeys.available()).toBe(false);
    expect(await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'unavailable',
    });
    expect(fixture.calls.passkeyPromptCount).toBe(0);

    fixture.calls.passkeySupported = true;
    expect(
      await ports.passkeys.authenticate(
        { ...OPTIONS, rpId: 'other.example.test' },
        new TestAbort().signal,
      ),
    ).toEqual({ kind: 'failed', reason: 'invalidResponse' });
    expect(fixture.calls.passkeyPromptCount).toBe(0);
  });

  it('maps user cancellation and rejects malformed assertion artifacts', async () => {
    const fixture = createNativeSignInFixture('ios');
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    fixture.calls.passkeyResult = async () => null;
    expect(await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'cancelled',
    });

    fixture.calls.passkeyResult = async () => ({ ...ASSERTION, type: 'registration' });
    expect(await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'failed',
      reason: 'invalidResponse',
    });
  });

  it('maps the installed module cancellation error and catches capability failures', async () => {
    const fixture = createNativeSignInFixture('ios');
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    fixture.calls.passkeyResult = async () => {
      throw { name: 'UserCancelledException' };
    };
    expect(await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'cancelled',
    });

    fixture.calls.passkeyAvailabilityError = new Error('native bridge unavailable');
    expect(await ports.passkeys.available()).toBe(false);
    expect(await ports.passkeys.authenticate(OPTIONS, new TestAbort().signal)).toEqual({
      kind: 'unavailable',
    });
  });
});
