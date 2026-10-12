import { type NativeProviderCredential, type NativeProviderMethod } from '@app/sdk';
import type { AbortSignalPort, ProviderSignInPort } from '@app/native-auth';
import type { NativeSignInModules, NativeSignInSettings } from '../types/sign-in-modules';
import type { NativePromptResult } from '@app/native-auth';
import { createNativePromptLease, type NativePromptLease } from '../logic/prompt-lease';
import {
  errorHasCode,
  isNonceDigest,
  isRecord,
  nonEmptyString,
  promptFailure,
} from '../logic/native-sign-in-values';

const NATIVE_GOOGLE_MODE = 'googleIdentityToken';
const NATIVE_APPLE_MODE = 'appleIdentityTokenAndCode';
const NATIVE_FACEBOOK_MODE = 'facebook';
const NATIVE_GOOGLE_CREDENTIAL = 'googleIdentityToken';
const NATIVE_APPLE_CREDENTIAL = 'appleIdentityTokenAndCode';
const NATIVE_FACEBOOK_LIMITED_CREDENTIAL = 'facebookLimitedToken';
const NATIVE_FACEBOOK_ACCESS_CREDENTIAL = 'facebookAccessToken';
const GOOGLE_CLIENT_ID_PATTERN = /^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/u;
const FACEBOOK_PERMISSIONS = ['public_profile', 'email'];
const CANCEL_CODES = ['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED', 'UserCancelled'];

interface FacebookFlowResult {
  login: unknown;
  token: unknown;
}

function googleClientScheme(clientId: string): string | undefined {
  if (!GOOGLE_CLIENT_ID_PATTERN.test(clientId)) return undefined;
  const suffix = '.apps.googleusercontent.com';
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

function googleConfigured(
  method: NativeProviderMethod,
  modules: NativeSignInModules,
  settings: NativeSignInSettings,
): boolean {
  if (
    !modules.google ||
    method.id !== 'google' ||
    method.mode !== NATIVE_GOOGLE_MODE ||
    method.sdk?.kind !== 'google'
  ) {
    return false;
  }
  const sdk = method.sdk;
  if (!sdk || !GOOGLE_CLIENT_ID_PATTERN.test(sdk.webClientId)) return false;
  if (modules.platform === 'android') return true;
  return (
    modules.platform === 'ios' &&
    modules.apple !== undefined &&
    modules.appleScopes !== undefined &&
    nonEmptyString(sdk.iosClientId) &&
    settings.googleIosUrlScheme === googleClientScheme(sdk.iosClientId)
  );
}

function appleAvailable(
  method: NativeProviderMethod,
  modules: NativeSignInModules,
  settings: NativeSignInSettings,
): boolean {
  return (
    modules.platform === 'ios' &&
    settings.appleSignInEnabled &&
    method.id === 'apple' &&
    method.mode === NATIVE_APPLE_MODE &&
    method.sdk?.kind === 'apple' &&
    nonEmptyString(method.sdk.appId) &&
    method.sdk.appId === settings.iosBundleIdentifier
  );
}

function facebookAvailable(
  method: NativeProviderMethod,
  modules: NativeSignInModules,
  settings: NativeSignInSettings,
): boolean {
  return (
    (modules.platform === 'ios' || modules.platform === 'android') &&
    modules.facebook !== undefined &&
    method.id === 'facebook' &&
    method.mode === NATIVE_FACEBOOK_MODE &&
    method.sdk?.kind === 'facebook' &&
    /^\d+$/u.test(settings.facebookAppId ?? '') &&
    settings.facebookAppId === method.sdk.appId &&
    nonEmptyString(settings.facebookClientToken) &&
    !/\s/u.test(settings.facebookClientToken)
  );
}

function googleCredential(
  value: unknown,
  nonceDigest: string,
): NativePromptResult<NativeProviderCredential> {
  if (!isRecord(value) || typeof value.type !== 'string') return promptFailure('invalidResponse');
  if (value.type === 'cancelled') return { kind: 'cancelled' };
  if (value.type === 'noSavedCredentialFound') return { kind: 'unavailable' };
  if (value.type !== 'success' || !isRecord(value.data) || !nonEmptyString(value.data.idToken)) {
    return promptFailure('invalidResponse');
  }
  return {
    kind: 'success',
    value: {
      kind: NATIVE_GOOGLE_CREDENTIAL,
      identityToken: value.data.idToken,
      nonceDigest,
    },
  };
}

function appleCredential(
  value: unknown,
  nonceDigest: string,
  state: string,
): NativePromptResult<NativeProviderCredential> {
  if (
    !isRecord(value) ||
    value.state !== state ||
    !nonEmptyString(value.identityToken) ||
    !nonEmptyString(value.authorizationCode)
  ) {
    return promptFailure('invalidResponse');
  }
  return {
    kind: 'success',
    value: {
      kind: NATIVE_APPLE_CREDENTIAL,
      identityToken: value.identityToken,
      authorizationCode: value.authorizationCode,
      nonceDigest,
    },
  };
}

function facebookCredential(
  value: FacebookFlowResult,
  modules: NativeSignInModules,
  settings: NativeSignInSettings,
  nonceDigest: string,
): NativePromptResult<NativeProviderCredential> {
  if (!isRecord(value.login) || typeof value.login.isCancelled !== 'boolean') {
    return promptFailure('invalidResponse');
  }
  if (value.login.isCancelled) return { kind: 'cancelled' };
  if (!isRecord(value.token)) return promptFailure('invalidResponse');

  if (modules.platform === 'ios') {
    if (!nonEmptyString(value.token.authenticationToken) || value.token.nonce !== nonceDigest) {
      return promptFailure('invalidResponse');
    }
    return {
      kind: 'success',
      value: {
        kind: NATIVE_FACEBOOK_LIMITED_CREDENTIAL,
        authenticationToken: value.token.authenticationToken,
        nonceDigest,
      },
    };
  }

  if (
    modules.platform !== 'android' ||
    !nonEmptyString(value.token.accessToken) ||
    value.token.applicationID !== settings.facebookAppId
  ) {
    return promptFailure('invalidResponse');
  }
  return {
    kind: 'success',
    value: {
      kind: NATIVE_FACEBOOK_ACCESS_CREDENTIAL,
      accessToken: value.token.accessToken,
    },
  };
}

function providerFailure<T>(error: unknown): ReturnType<typeof promptFailure<T>> {
  return errorHasCode(error, CANCEL_CODES) ? { kind: 'cancelled' } : promptFailure('sdk');
}

function createFacebookFlow(
  modules: NativeSignInModules,
  nonceDigest: string,
): Promise<FacebookFlowResult> {
  const facebook = modules.facebook;
  if (!facebook) return Promise.reject(new Error('Facebook module is unavailable'));
  const login =
    modules.platform === 'ios'
      ? facebook.loginManager.logInWithPermissions(
          [...FACEBOOK_PERMISSIONS],
          'limited',
          nonceDigest,
        )
      : facebook.loginManager.logInWithPermissions([...FACEBOOK_PERMISSIONS]);
  return login.then(async (loginResult) => {
    if (!isRecord(loginResult) || loginResult.isCancelled !== false) {
      return { login: loginResult, token: undefined };
    }
    const token =
      modules.platform === 'ios'
        ? await facebook.authenticationToken.getAuthenticationTokenIOS()
        : await facebook.accessToken.getCurrentAccessToken();
    return { login: loginResult, token };
  });
}

export function createProviderSignInPort(
  modules: NativeSignInModules,
  settings: NativeSignInSettings,
  lease: NativePromptLease = createNativePromptLease(),
): ProviderSignInPort {
  let initializedFacebookAppId: string | undefined;

  const available = async (method: NativeProviderMethod): Promise<boolean> => {
    if (googleConfigured(method, modules, settings)) {
      try {
        return (await modules.google?.isAvailable()) === true;
      } catch {
        return false;
      }
    }
    if (facebookAvailable(method, modules, settings)) {
      return true;
    }
    if (!appleAvailable(method, modules, settings)) return false;
    try {
      return (await modules.apple?.isAvailableAsync()) === true;
    } catch {
      return false;
    }
  };

  return {
    available,

    async authenticate({ method, nonceDigest, state }, signal: AbortSignalPort) {
      if (!isNonceDigest(nonceDigest)) return promptFailure('invalidResponse');
      if (signal.aborted) return { kind: 'cancelled' };
      if (!(await available(method))) return { kind: 'unavailable' };

      if (method.mode === NATIVE_GOOGLE_MODE) {
        const google = modules.google;
        if (!google) return { kind: 'unavailable' };
        return lease.run<unknown, NativeProviderCredential>(
          signal,
          async () => {
            const sdk = method.sdk;
            if (!sdk || sdk.kind !== 'google') throw new Error('Google configuration is invalid');
            await google.configure({
              webClientId: sdk.webClientId,
              ...(modules.platform === 'ios' && sdk.iosClientId
                ? { iosClientId: sdk.iosClientId }
                : {}),
              nonce: nonceDigest,
            });
            return google.presentExplicitSignIn();
          },
          (value) => googleCredential(value, nonceDigest),
          providerFailure,
        );
      }

      if (method.mode === NATIVE_APPLE_MODE) {
        const apple = modules.apple;
        const scopes = modules.appleScopes;
        if (!apple || !scopes) return { kind: 'unavailable' };
        if (!nonEmptyString(state)) return promptFailure('invalidResponse');
        return lease.run<unknown, NativeProviderCredential>(
          signal,
          () => {
            const sdk = method.sdk;
            if (!sdk || sdk.kind !== 'apple') throw new Error('Apple configuration is invalid');
            return apple.signInAsync({
              requestedScopes: [scopes.fullName, scopes.email],
              state,
              nonce: nonceDigest,
            });
          },
          (value) => appleCredential(value, nonceDigest, state),
          providerFailure,
        );
      }

      if (method.mode === NATIVE_FACEBOOK_MODE) {
        const facebook = modules.facebook;
        if (!facebook) return { kind: 'unavailable' };
        return lease.run<FacebookFlowResult, NativeProviderCredential>(
          signal,
          () => {
            const sdk = method.sdk;
            if (!sdk || sdk.kind !== 'facebook')
              throw new Error('Facebook configuration is invalid');
            if (initializedFacebookAppId !== sdk.appId) {
              facebook.settings.setAppID(sdk.appId);
              if (settings.facebookClientToken) {
                facebook.settings.setClientToken(settings.facebookClientToken);
              }
              if (settings.facebookDisplayName) {
                facebook.settings.setAppName(settings.facebookDisplayName);
              }
              facebook.settings.initializeSDK();
              initializedFacebookAppId = sdk.appId;
            }
            return createFacebookFlow(modules, nonceDigest);
          },
          (value) => facebookCredential(value, modules, settings, nonceDigest),
          providerFailure,
        );
      }

      return { kind: 'unavailable' };
    },
  };
}
