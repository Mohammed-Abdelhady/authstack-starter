import type { NativeProviderMethod } from '@app/sdk';
import { createNativeAuthClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createNativeSignInPorts } from '../src/native-sign-in-ports';
import {
  createNativeSignInFixture,
  createNativeSignInSettings,
} from './support/native-sign-in-modules';
import { TestAbort } from './support/abort';

const NONCE_DIGEST = 'a'.repeat(64);
const GOOGLE_METHOD: NativeProviderMethod = {
  id: 'google',
  displayName: 'Google',
  mode: 'googleIdentityToken',
  sdk: {
    kind: 'google',
    webClientId: 'web-client.apps.googleusercontent.com',
    iosClientId: 'ios-client.apps.googleusercontent.com',
  },
};
const APPLE_METHOD: NativeProviderMethod = {
  id: 'apple',
  displayName: 'Apple',
  mode: 'appleIdentityTokenAndCode',
  sdk: { kind: 'apple', appId: 'com.example.mobile' },
};
const FACEBOOK_METHOD: NativeProviderMethod = {
  id: 'facebook',
  displayName: 'Facebook',
  mode: 'facebook',
  sdk: { kind: 'facebook', appId: '12345' },
};
const SYSTEM_METHOD: NativeProviderMethod = {
  id: 'github',
  displayName: 'GitHub',
  mode: 'system',
};

describe('native provider sign-in port', () => {
  it('reports unavailable when optional native provider modules are absent', async () => {
    const ports = createNativeSignInPorts({ platform: 'ios' }, createNativeSignInSettings());
    for (const method of [GOOGLE_METHOD, APPLE_METHOD, FACEBOOK_METHOD]) {
      expect(await ports.providerSignIn.available(method)).toBe(false);
      expect(
        await ports.providerSignIn.authenticate(
          { method, nonceDigest: NONCE_DIGEST, state: 'native-state' },
          new TestAbort().signal,
        ),
      ).toEqual({ kind: 'unavailable' });
    }
  });

  it('gates Google, Apple, Facebook, and system methods by platform and public configuration', async () => {
    const ios = createNativeSignInFixture('ios');
    const iosPorts = createNativeSignInPorts(ios.modules, createNativeSignInSettings());
    expect(await iosPorts.providerSignIn.available(GOOGLE_METHOD)).toBe(true);
    expect(await iosPorts.providerSignIn.available(APPLE_METHOD)).toBe(true);
    expect(await iosPorts.providerSignIn.available(FACEBOOK_METHOD)).toBe(true);
    expect(await iosPorts.providerSignIn.available(SYSTEM_METHOD)).toBe(false);

    const wrongScheme = createNativeSignInPorts(ios.modules, {
      ...createNativeSignInSettings(),
      googleIosUrlScheme: 'com.googleusercontent.apps.other-client',
    });
    expect(await wrongScheme.providerSignIn.available(GOOGLE_METHOD)).toBe(false);
    const wrongFacebookApp = createNativeSignInPorts(ios.modules, {
      ...createNativeSignInSettings(),
      facebookAppId: '999',
    });
    expect(await wrongFacebookApp.providerSignIn.available(FACEBOOK_METHOD)).toBe(false);
    const wrongAppleBundle = createNativeSignInPorts(ios.modules, {
      ...createNativeSignInSettings(),
      iosBundleIdentifier: 'com.other.app',
    });
    expect(await wrongAppleBundle.providerSignIn.available(APPLE_METHOD)).toBe(false);

    const android = createNativeSignInFixture('android');
    const androidPorts = createNativeSignInPorts(android.modules, createNativeSignInSettings());
    expect(await androidPorts.providerSignIn.available(GOOGLE_METHOD)).toBe(true);
    expect(await androidPorts.providerSignIn.available(APPLE_METHOD)).toBe(false);
    expect(await androidPorts.providerSignIn.available(FACEBOOK_METHOD)).toBe(true);

    ios.calls.appleAvailable = false;
    expect(await iosPorts.providerSignIn.available(APPLE_METHOD)).toBe(false);
  });

  it('uses a fresh Google identity token and passes the adapter artifact through the SDK client', async () => {
    const fixture = createNativeSignInFixture('ios');
    fixture.calls.googleResult = async () => ({
      type: 'success',
      data: {
        idToken: 'google-id-token',
        user: { id: 'local-account', email: 'private@example.test' },
      },
    });
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const prompt = await ports.providerSignIn.authenticate(
      { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
      new TestAbort().signal,
    );

    expect(fixture.calls.googleConfiguration).toEqual({
      webClientId: GOOGLE_METHOD.sdk.webClientId,
      iosClientId: GOOGLE_METHOD.sdk.iosClientId,
      nonce: NONCE_DIGEST,
    });
    expect(fixture.calls.googlePromptCount).toBe(1);
    expect(prompt).toEqual({
      kind: 'success',
      value: {
        kind: 'googleIdentityToken',
        identityToken: 'google-id-token',
        nonceDigest: NONCE_DIGEST,
      },
    });
    if (prompt.kind !== 'success') throw new Error('Expected a Google credential');

    const requests: { method: string; path: string; body?: unknown }[] = [];
    const client = createNativeAuthClient(async (call) => {
      requests.push(call);
      return {
        status: 200,
        body: {
          success: true,
          data: {
            attemptId: 'attempt-1',
            stage: 'firstFactorRequired',
            expiresAt: '2030-01-01T00:00:00.000Z',
            factors: ['password'],
          },
        },
      };
    });
    const result = await client.provider({ id: 'attempt-1', secret: 'a'.repeat(43) }, prompt.value);
    expect(result.stage).toBe('firstFactorRequired');
    expect(requests[0]?.body).toEqual({
      kind: 'googleIdentityToken',
      identityToken: 'google-id-token',
      nonceDigest: NONCE_DIGEST,
    });
  });

  it('sends Apple state and nonce and requires the echoed state, identity token, and code', async () => {
    const fixture = createNativeSignInFixture('ios');
    fixture.calls.appleResult = async () => ({
      state: 'request-state',
      identityToken: 'apple-token',
      authorizationCode: 'apple-code',
    });
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const prompt = await ports.providerSignIn.authenticate(
      { method: APPLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'request-state' },
      new TestAbort().signal,
    );
    expect(fixture.calls.appleOptions).toEqual({
      requestedScopes: [0, 1],
      state: 'request-state',
      nonce: NONCE_DIGEST,
    });
    expect(prompt).toEqual({
      kind: 'success',
      value: {
        kind: 'appleIdentityTokenAndCode',
        identityToken: 'apple-token',
        authorizationCode: 'apple-code',
        nonceDigest: NONCE_DIGEST,
      },
    });

    fixture.calls.appleResult = async () => ({
      state: 'wrong-state',
      identityToken: 'apple-token',
      authorizationCode: 'apple-code',
    });
    const invalid = await ports.providerSignIn.authenticate(
      { method: APPLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'request-state' },
      new TestAbort().signal,
    );
    expect(invalid).toEqual({ kind: 'failed', reason: 'invalidResponse' });
  });

  it('uses Facebook limited login on iOS and an app-bound access token on Android', async () => {
    const ios = createNativeSignInFixture('ios');
    ios.calls.facebookLoginResult = async () => ({ isCancelled: false });
    ios.calls.facebookAuthenticationTokenResult = async () => ({
      authenticationToken: 'limited-token',
      nonce: NONCE_DIGEST,
    });
    const iosPorts = createNativeSignInPorts(ios.modules, createNativeSignInSettings());
    const iosResult = await iosPorts.providerSignIn.authenticate(
      { method: FACEBOOK_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
      new TestAbort().signal,
    );
    expect(ios.calls.facebookLoginCalls[0]).toEqual({
      permissions: ['public_profile', 'email'],
      tracking: 'limited',
      nonce: NONCE_DIGEST,
    });
    expect(ios.calls.facebookSetup).toEqual([
      'app:12345',
      'client:public-client-token',
      'name:Example Mobile',
      'initialize',
    ]);
    expect(iosResult).toEqual({
      kind: 'success',
      value: {
        kind: 'facebookLimitedToken',
        authenticationToken: 'limited-token',
        nonceDigest: NONCE_DIGEST,
      },
    });

    const android = createNativeSignInFixture('android');
    android.calls.facebookLoginResult = async () => ({ isCancelled: false });
    android.calls.facebookAccessTokenResult = async () => ({
      accessToken: 'android-access-token',
      applicationID: '12345',
    });
    const androidPorts = createNativeSignInPorts(android.modules, createNativeSignInSettings());
    const androidResult = await androidPorts.providerSignIn.authenticate(
      { method: FACEBOOK_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
      new TestAbort().signal,
    );
    expect(android.calls.facebookLoginCalls[0]).toEqual({
      permissions: ['public_profile', 'email'],
    });
    expect(androidResult).toEqual({
      kind: 'success',
      value: { kind: 'facebookAccessToken', accessToken: 'android-access-token' },
    });
  });

  it('rejects a Facebook token for another app and reports explicit cancellation', async () => {
    const fixture = createNativeSignInFixture('android');
    fixture.calls.facebookLoginResult = async () => ({ isCancelled: false });
    fixture.calls.facebookAccessTokenResult = async () => ({
      accessToken: 'android-access-token',
      applicationID: '999',
    });
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    const invalid = await ports.providerSignIn.authenticate(
      { method: FACEBOOK_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
      new TestAbort().signal,
    );
    expect(invalid).toEqual({ kind: 'failed', reason: 'invalidResponse' });

    fixture.calls.facebookLoginResult = async () => ({ isCancelled: true });
    const cancelled = await ports.providerSignIn.authenticate(
      { method: FACEBOOK_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
      new TestAbort().signal,
    );
    expect(cancelled).toEqual({ kind: 'cancelled' });
  });

  it('distinguishes Google cancellation, no credential, malformed responses, and SDK errors', async () => {
    const fixture = createNativeSignInFixture('android');
    const ports = createNativeSignInPorts(fixture.modules, createNativeSignInSettings());
    fixture.calls.googleResult = async () => ({ type: 'noSavedCredentialFound', data: null });
    expect(
      await ports.providerSignIn.authenticate(
        { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
        new TestAbort().signal,
      ),
    ).toEqual({ kind: 'unavailable' });

    fixture.calls.googleResult = async () => ({ type: 'success', data: null });
    expect(
      await ports.providerSignIn.authenticate(
        { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
        new TestAbort().signal,
      ),
    ).toEqual({ kind: 'failed', reason: 'invalidResponse' });

    fixture.calls.googleResult = async () => {
      throw { code: 'SIGN_IN_CANCELLED' };
    };
    expect(
      await ports.providerSignIn.authenticate(
        { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
        new TestAbort().signal,
      ),
    ).toEqual({ kind: 'cancelled' });

    fixture.calls.googleResult = async () => {
      throw new Error('unexpected native error');
    };
    expect(
      await ports.providerSignIn.authenticate(
        { method: GOOGLE_METHOD, nonceDigest: 'not-a-digest', state: 'unused' },
        new TestAbort().signal,
      ),
    ).toEqual({ kind: 'failed', reason: 'invalidResponse' });
    expect(fixture.calls.googlePromptCount).toBe(3);
    expect(
      await ports.providerSignIn.authenticate(
        { method: GOOGLE_METHOD, nonceDigest: NONCE_DIGEST, state: 'unused' },
        new TestAbort().signal,
      ),
    ).toEqual({ kind: 'failed', reason: 'sdk' });
  });
});
