import { createNativeSignInPorts, readNativeSignInSettings } from '@app/native-adapters';
import type {
  NativeSignInDependencies,
  NativeSignInModules,
  NativeSignInPlatform,
} from '@app/native-adapters';
import Constants from 'expo-constants';
import { AppleAuthenticationScope } from 'expo-apple-authentication/build/AppleAuthentication.types'; // feature:apple
import { Platform } from 'react-native';
import { AccessToken, AuthenticationToken, LoginManager, Settings } from 'react-native-fbsdk-next'; // feature:facebook

// feature:google:start
let googleModule: Promise<typeof import('react-native-nitro-google-signin')> | undefined;
// feature:google:end
// feature:passkeys:start
let passkeyModule: Promise<typeof import('react-native-passkeys')> | undefined;
// feature:passkeys:end
// feature:apple:start
let appleModule:
  Promise<typeof import('expo-apple-authentication/build/AppleAuthentication')> | undefined;
// feature:apple:end

// feature:google:start
function loadGoogleModule(): Promise<typeof import('react-native-nitro-google-signin')> {
  googleModule ??= import('react-native-nitro-google-signin');
  return googleModule;
}
// feature:google:end

// feature:passkeys:start
function loadPasskeyModule(): Promise<typeof import('react-native-passkeys')> {
  passkeyModule ??= import('react-native-passkeys');
  return passkeyModule;
}
// feature:passkeys:end

// feature:apple:start
function loadAppleModule(): Promise<
  typeof import('expo-apple-authentication/build/AppleAuthentication')
> {
  appleModule ??= import('expo-apple-authentication/build/AppleAuthentication');
  return appleModule;
}
// feature:apple:end

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

// feature:apple:start
function isAppleScope(value: number): value is AppleAuthenticationScope {
  return value === AppleAuthenticationScope.FULL_NAME || value === AppleAuthenticationScope.EMAIL;
}
// feature:apple:end

function createModules(): NativeSignInModules {
  return {
    platform: currentPlatform(),
    // feature:google:start
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
    // feature:google:end
    // feature:apple:start
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
    // feature:apple:end
    // feature:facebook:start
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
    // feature:facebook:end
    // feature:passkeys:start
    passkeys: {
      isSupported: async () => (await loadPasskeyModule()).isSupported(),
      get: async (options) => (await loadPasskeyModule()).get(options),
    },
    // feature:passkeys:end
  };
}

export function createShellNativeSignIn(): NativeSignInDependencies {
  const settings = readNativeSignInSettings(
    Constants.expoConfig?.extra?.nativeSignIn,
    Constants.expoConfig?.ios?.bundleIdentifier,
  );
  return createNativeSignInPorts(createModules(), settings);
}
