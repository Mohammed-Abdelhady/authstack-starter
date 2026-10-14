import type { NativeSignInSettings } from '../types/sign-in-modules';
import { isRecord, nonEmptyString } from './native-sign-in-values';

const FACEBOOK_APP_ID_PATTERN = /^\d+$/u;

interface NativeSignInMetadata {
  googleIosUrlScheme?: unknown;
  appleSignIn?: unknown;
  facebookAppId?: unknown;
  facebookClientToken?: unknown;
  facebookDisplayName?: unknown;
  passkeyRpId?: unknown;
}

function configuredString(
  settings: NativeSignInMetadata,
  key: keyof NativeSignInMetadata,
): string | undefined {
  const value = settings[key];
  return nonEmptyString(value) && value === value.trim() ? value : undefined;
}

/** Reads only the whitelisted public app metadata used to gate native sign-in. */
export function readNativeSignInSettings(
  metadata: unknown,
  iosBundleIdentifier: unknown,
): NativeSignInSettings {
  const settings: NativeSignInMetadata = isRecord(metadata) ? metadata : {};
  const googleIosUrlScheme = configuredString(settings, 'googleIosUrlScheme');
  const passkeyRpId = configuredString(settings, 'passkeyRpId');
  const facebookAppId = configuredString(settings, 'facebookAppId');
  const facebookClientToken = configuredString(settings, 'facebookClientToken');
  const facebookDisplayName = configuredString(settings, 'facebookDisplayName');
  const facebookEnabled =
    facebookAppId !== undefined &&
    FACEBOOK_APP_ID_PATTERN.test(facebookAppId) &&
    facebookClientToken !== undefined &&
    !/\s/u.test(facebookClientToken);

  return {
    appleSignInEnabled: settings.appleSignIn === true,
    ...(googleIosUrlScheme === undefined ? {} : { googleIosUrlScheme }),
    ...(nonEmptyString(iosBundleIdentifier) && iosBundleIdentifier === iosBundleIdentifier.trim()
      ? { iosBundleIdentifier }
      : {}),
    ...(facebookEnabled ? { facebookAppId, facebookClientToken, facebookDisplayName } : {}),
    ...(passkeyRpId === undefined ? {} : { passkeyRpId }),
  };
}
