import type {
  AppleAuthenticationApi,
  FacebookSignInApi,
  GoogleSignInApi,
  NativePasskeysApi,
  NativeSignInModules,
  NativeSignInPlatform,
  NativeSignInSettings,
} from '../../src/types/sign-in-modules';

export interface NativeSignInCalls {
  googleAvailable: boolean;
  googleAvailabilityError?: unknown;
  googleConfiguration?: { webClientId: string; iosClientId?: string; nonce: string };
  googlePromptCount: number;
  googleResult: () => Promise<unknown>;
  appleAvailable: boolean;
  appleAvailabilityError?: unknown;
  appleOptions?: { requestedScopes: number[]; state: string; nonce: string };
  appleResult: () => Promise<unknown>;
  facebookSetup: string[];
  facebookLoginCalls: { permissions: string[]; tracking?: string; nonce?: string }[];
  facebookLoginResult: () => Promise<unknown>;
  facebookAccessTokenResult: () => Promise<unknown>;
  facebookAuthenticationTokenResult: () => Promise<unknown>;
  passkeySupported: boolean;
  passkeyAvailabilityError?: unknown;
  passkeyOptions?: Parameters<NativePasskeysApi['get']>[0];
  passkeyPromptCount: number;
  passkeyResult: () => Promise<unknown>;
}

export interface NativeSignInFixture {
  modules: NativeSignInModules;
  calls: NativeSignInCalls;
}

export function createNativeSignInFixture(platform: NativeSignInPlatform): NativeSignInFixture {
  const calls: NativeSignInCalls = {
    googleAvailable: true,
    googlePromptCount: 0,
    googleResult: async () => ({ type: 'cancelled', data: null }),
    appleAvailable: true,
    appleResult: async () => ({
      state: 'state',
      identityToken: 'apple-token',
      authorizationCode: 'apple-code',
    }),
    facebookSetup: [],
    facebookLoginCalls: [],
    facebookLoginResult: async () => ({ isCancelled: true }),
    facebookAccessTokenResult: async () => null,
    facebookAuthenticationTokenResult: async () => null,
    passkeySupported: true,
    passkeyPromptCount: 0,
    passkeyResult: async () => null,
  };

  const google: GoogleSignInApi = {
    isAvailable: async () => {
      if (calls.googleAvailabilityError !== undefined) throw calls.googleAvailabilityError;
      return calls.googleAvailable;
    },
    configure: (options) => {
      calls.googleConfiguration = options;
    },
    presentExplicitSignIn: () => {
      calls.googlePromptCount += 1;
      return calls.googleResult();
    },
  };
  const apple: AppleAuthenticationApi = {
    isAvailableAsync: async () => {
      if (calls.appleAvailabilityError !== undefined) throw calls.appleAvailabilityError;
      return calls.appleAvailable;
    },
    signInAsync: (options) => {
      calls.appleOptions = options;
      return calls.appleResult();
    },
  };
  const facebook: FacebookSignInApi = {
    settings: {
      setAppID: (value) => calls.facebookSetup.push(`app:${value}`),
      setClientToken: (value) => calls.facebookSetup.push(`client:${value}`),
      setAppName: (value) => calls.facebookSetup.push(`name:${value}`),
      initializeSDK: () => calls.facebookSetup.push('initialize'),
    },
    loginManager: {
      logInWithPermissions: (permissions, tracking, nonce) => {
        calls.facebookLoginCalls.push({
          permissions,
          ...(tracking === undefined ? {} : { tracking }),
          ...(nonce === undefined ? {} : { nonce }),
        });
        return calls.facebookLoginResult();
      },
    },
    accessToken: { getCurrentAccessToken: () => calls.facebookAccessTokenResult() },
    authenticationToken: {
      getAuthenticationTokenIOS: () => calls.facebookAuthenticationTokenResult(),
    },
  };
  const passkeys: NativePasskeysApi = {
    isSupported: () => {
      if (calls.passkeyAvailabilityError !== undefined) throw calls.passkeyAvailabilityError;
      return calls.passkeySupported;
    },
    get: (options) => {
      calls.passkeyOptions = options;
      calls.passkeyPromptCount += 1;
      return calls.passkeyResult();
    },
  };

  return {
    modules: {
      platform,
      google,
      apple,
      appleScopes: { fullName: 0, email: 1 },
      facebook,
      passkeys,
    },
    calls,
  };
}

export function createNativeSignInSettings(): NativeSignInSettings {
  return {
    googleIosUrlScheme: 'com.googleusercontent.apps.ios-client',
    appleSignInEnabled: true,
    iosBundleIdentifier: 'com.example.mobile',
    facebookAppId: '12345',
    facebookClientToken: 'public-client-token',
    facebookDisplayName: 'Example Mobile',
    passkeyRpId: 'example.test',
  };
}
