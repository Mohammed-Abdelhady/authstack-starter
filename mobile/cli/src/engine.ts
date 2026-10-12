import { NATIVE_MODULE_NAME, type DeviceKeyNativeApi, type KeyProtection } from '@app/device-key';
import { INSTALL_MARKER_FILE, recordMarkerFile } from '@app/native-adapters';
import type { AuthConfiguration } from '@app/native-auth';
import { requireNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { startShellAuth, type StartedShellAuth } from './shell';
import { createShellNativeSignIn } from './native-sign-in';

type ShellTimerHandle = ReturnType<typeof setTimeout>;

/** React Native provides the monotonic clock at run time. */
declare const performance: { now(): number };

/** Passes this shell's Expo module instances once to the shared adapter factory. */
export function createNativeShellAuth(
  configuration: AuthConfiguration,
  ephemeralBrowserSession: boolean,
  keyProtection: KeyProtection,
): Promise<StartedShellAuth> {
  const modules = {
    secureStore: SecureStore,
    keychainOptions: {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    },
    webBrowser: WebBrowser,
    crypto: Crypto,
    sha256Algorithm: Crypto.CryptoDigestAlgorithm.SHA256,
    linking: Linking,
    installMarker: new File(Paths.document, INSTALL_MARKER_FILE),
    recordMarker: new File(
      Paths.document,
      recordMarkerFile(configuration.clientId, configuration.environment),
    ),
    uuid: Crypto,
    clock: { date: Date, performance },
    timers: {
      setTimeout: (handler: () => void, milliseconds: number) => setTimeout(handler, milliseconds),
      clearTimeout: (handle: ShellTimerHandle) => clearTimeout(handle),
    },
    nativeSignIn: createShellNativeSignIn(),
  };
  return startShellAuth(
    {
      ...modules,
      deviceKey: requireNativeModule<DeviceKeyNativeApi>(NATIVE_MODULE_NAME),
      http: {
        fetch: (address, init) => fetch(address, init),
        createAbort: () => new AbortController(),
      },
    },
    { configuration, ephemeralBrowserSession, keyProtection },
  );
}
