import { NATIVE_APPLICATIONS_CONFIG_VARIABLE } from '../../session/constants/client-ids';
import {
  NATIVE_RP_ID_MAX_LENGTH,
  NATIVE_SDK_IDENTIFIER_MAX_LENGTH,
} from '../constants/native-sign-in-wire';
import type {
  NativeProviderSignInConfiguration,
  NativeSignInConfiguration,
} from '../types/native-application.type';

export function parseSignIn(
  value: unknown,
  index: number,
  clientId: string,
): NativeSignInConfiguration | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw entryError(index, clientId, 'signIn must be an object');
  const keys = new Set([
    'password',
    'emailLink',
    'passkeys',
    'registration',
    'recovery',
    'providers',
    'origins',
    'rpId',
  ]);
  for (const key of Object.keys(value)) {
    if (!keys.has(key))
      throw entryError(index, clientId, `signIn has unknown key "${key}"`);
  }
  const flags = [
    'password',
    'emailLink',
    'passkeys',
    'registration',
    'recovery',
  ] as const;
  for (const flag of flags) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') {
      throw entryError(index, clientId, `signIn.${flag} must be boolean`);
    }
  }
  const origins = value.origins;
  if (
    origins !== undefined &&
    (!Array.isArray(origins) ||
      origins.length === 0 ||
      origins.some(
        (origin: unknown) =>
          typeof origin !== 'string' ||
          (!/^https:\/\/[^/]+$/u.test(origin) &&
            !/^android:apk-key-hash:[A-Za-z0-9_-]{43}$/u.test(origin)),
      ))
  ) {
    throw entryError(
      index,
      clientId,
      'signIn.origins must contain exact HTTPS or Android app origins',
    );
  }
  const rpId = value.rpId;
  if (
    rpId !== undefined &&
    (!isNonEmptyString(rpId) ||
      /[:/\s]/u.test(rpId) ||
      rpId.length > NATIVE_RP_ID_MAX_LENGTH)
  ) {
    throw entryError(
      index,
      clientId,
      `signIn.rpId must be a hostname of at most ${NATIVE_RP_ID_MAX_LENGTH} characters`,
    );
  }
  if (value.passkeys === true && (!origins || !rpId)) {
    throw entryError(
      index,
      clientId,
      'signIn.passkeys requires origins and rpId',
    );
  }
  const providers = parseSignInProviders(value.providers, index, clientId);
  return {
    password: value.password as boolean | undefined,
    emailLink: value.emailLink as boolean | undefined,
    passkeys: value.passkeys as boolean | undefined,
    registration: value.registration as boolean | undefined,
    recovery: value.recovery as boolean | undefined,
    providers,
    origins: origins as string[] | undefined,
    rpId,
  };
}

function parseSignInProviders(
  value: unknown,
  index: number,
  clientId: string,
): NativeProviderSignInConfiguration[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) {
    throw entryError(
      index,
      clientId,
      'signIn.providers must be an array of at most 32',
    );
  }
  const seen = new Set<string>();
  return value.map((provider: unknown) => {
    if (
      !isRecord(provider) ||
      !isNonEmptyString(provider.id) ||
      ![
        'system',
        'googleIdentityToken',
        'appleIdentityTokenAndCode',
        'facebook',
      ].includes(String(provider.mode))
    ) {
      throw entryError(
        index,
        clientId,
        'signIn.providers entry must have id and mode',
      );
    }
    if (seen.has(provider.id))
      throw entryError(index, clientId, 'signIn.providers has duplicate id');
    seen.add(provider.id);
    const mode = provider.mode;
    if (
      mode === 'googleIdentityToken' &&
      !isNonEmptyString(provider.webClientId)
    ) {
      throw entryError(index, clientId, 'Google SDK mode requires webClientId');
    }
    if (
      (mode === 'appleIdentityTokenAndCode' || mode === 'facebook') &&
      !isNonEmptyString(provider.appId)
    ) {
      throw entryError(
        index,
        clientId,
        'Apple and Facebook SDK modes require appId',
      );
    }
    for (const key of ['webClientId', 'iosClientId', 'appId']) {
      const identifier = provider[key];
      if (
        identifier !== undefined &&
        (!isNonEmptyString(identifier) ||
          identifier.length > NATIVE_SDK_IDENTIFIER_MAX_LENGTH)
      ) {
        throw entryError(
          index,
          clientId,
          `signIn.providers ${key} must be a non-empty string of at most ${NATIVE_SDK_IDENTIFIER_MAX_LENGTH} characters`,
        );
      }
    }
    return {
      id: provider.id,
      mode: mode as NativeProviderSignInConfiguration['mode'],
      webClientId: provider.webClientId as string | undefined,
      iosClientId: provider.iosClientId as string | undefined,
      appId: provider.appId as string | undefined,
    };
  });
}

function entryError(index: number, clientId: unknown, reason: string): Error {
  const label =
    typeof clientId === 'string' && clientId.length > 0
      ? `entry ${JSON.stringify(clientId)}`
      : `entry at index ${index}`;
  return new Error(
    `${NATIVE_APPLICATIONS_CONFIG_VARIABLE} ${label}: ${reason}.`,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
