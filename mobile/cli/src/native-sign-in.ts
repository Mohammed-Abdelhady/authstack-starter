import { createNativeSignInPorts, readNativeSignInSettings } from '@app/native-adapters';
import type {
  NativeSignInDependencies,
  NativeSignInModules,
  NativeSignInPlatform,
} from '@app/native-adapters';
import Constants from 'expo-constants';
import { AppleAuthenticationScope } from 'expo-apple-authentication/build/AppleAuthentication.types';
import { Platform } from 'react-native';
import { AccessToken, AuthenticationToken, LoginManager, Settings } from 'react-native-fbsdk-next';

let googleModule: Promise<typeof import('react-native-nitro-google-signin')> | undefined;
let passkeyModule: Promise<typeof import('react-native-passkeys')> | undefined;
let appleModule:
  Promise<typeof import('expo-apple-authentication/build/AppleAuthentication')> | undefined;

function loadGoogleModule(): Promise<typeof import('react-native-nitro-google-signin')> {
  googleModule ??= import('react-native-nitro-google-signin');
  return googleModule;
}

function loadPasskeyModule(): Promise<typeof import('react-native-passkeys')> {
  passkeyModule ??= import('react-native-passkeys');
  return passkeyModule;
}

function loadAppleModule(): Promise<
  typeof import('expo-apple-authentication/build/AppleAuthentication')
> {
  appleModule ??= import('expo-apple-authentication/build/AppleAuthentication');
  return appleModule;
}

function currentPlatform(): NativeSignInPlatform {
  switch (Platform.OS) {
    case 'ios':
    case 'android':
    case 'web':
      return Platform.OS;
    default:
      return 'other';
  }
}

function isAppleScope(value: number): value is AppleAuthenticationScope {
  return value === AppleAuthenticationScope.FULL_NAME || value === AppleAuthenticationScope.EMAIL;
}

function createModules(): NativeSignInModules {
  return {
    platform: currentPlatform(),
    google: {
      isAvailable: async () => {
        try {
          await loadGoogleModule();
          return true;
        } catch {
          return false;
        }
      },
      configure: async (options) =>
        (await loadGoogleModule()).GoogleOneTapSignIn.configure(options),
      presentExplicitSignIn: async () =>
        (await loadGoogleModule()).GoogleOneTapSignIn.presentExplicitSignIn(),
    },
    apple: {
      isAvailableAsync: async () => (await loadAppleModule()).isAvailableAsync(),
      signInAsync: async ({ requestedScopes, state, nonce }) =>
        (await loadAppleModule()).signInAsync({
          requestedScopes: requestedScopes.filter(isAppleScope),
          state,
          nonce,
        }),
    },
    appleScopes: {
      fullName: AppleAuthenticationScope.FULL_NAME,
      email: AppleAuthenticationScope.EMAIL,
    },
    facebook: {
      settings: {
        setAppID: (appId) => Settings.setAppID(appId),
        setClientToken: (token) => Settings.setClientToken(token),
        setAppName: (name) => Settings.setAppName(name),
        initializeSDK: () => Settings.initializeSDK(),
      },
      loginManager: {
        logInWithPermissions: (permissions, tracking, nonce) =>
          LoginManager.logInWithPermissions(permissions, tracking, nonce),
      },
      accessToken: {
        getCurrentAccessToken: () => AccessToken.getCurrentAccessToken(),
      },
      authenticationToken: {
        getAuthenticationTokenIOS: () => AuthenticationToken.getAuthenticationTokenIOS(),
      },
    },
    passkeys: {
      isSupported: async () => (await loadPasskeyModule()).isSupported(),
      get: async (options) => (await loadPasskeyModule()).get(options),
    },
  };
}

export function createShellNativeSignIn(): NativeSignInDependencies {
  const settings = readNativeSignInSettings(
    Constants.expoConfig?.extra?.nativeSignIn,
    Constants.expoConfig?.ios?.bundleIdentifier,
  );
  return createNativeSignInPorts(createModules(), settings);
}
