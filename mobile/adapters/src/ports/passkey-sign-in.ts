import type { NativePasskeyAssertion, NativePasskeyOptions } from '@app/sdk';
import type { AbortSignalPort, PasskeyPort } from '@app/native-auth';
import type {
  NativePasskeysApi,
  NativePasskeyRequestOptions,
  NativePasskeyTransport,
  NativeSignInPlatform,
  NativeSignInSettings,
} from '../types/sign-in-modules';
import { createNativePromptLease, type NativePromptLease } from '../logic/prompt-lease';
import {
  errorHasCode,
  isRecord,
  nonEmptyString,
  promptFailure,
} from '../logic/native-sign-in-values';

const PASSKEY_CANCEL_CODES = [
  'ERR_REQUEST_CANCELED',
  'NotAllowedError',
  'UserCancelled',
  'UserCancelledException',
];
const PASSKEY_TRANSPORTS: readonly NativePasskeyTransport[] = [
  'ble',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];

function isPasskeyTransport(value: string): value is NativePasskeyTransport {
  return PASSKEY_TRANSPORTS.some((transport) => transport === value);
}

function isNativePlatform(platform: NativeSignInPlatform): boolean {
  return platform === 'ios' || platform === 'android';
}

function assertion(value: unknown): NativePasskeyAssertion | undefined {
  if (
    !isRecord(value) ||
    value.type !== 'public-key' ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.rawId) ||
    !isRecord(value.response) ||
    !nonEmptyString(value.response.clientDataJSON) ||
    !nonEmptyString(value.response.authenticatorData) ||
    !nonEmptyString(value.response.signature)
  ) {
    return undefined;
  }

  const attachment = value.authenticatorAttachment;
  if (attachment !== undefined && attachment !== 'platform' && attachment !== 'cross-platform') {
    return undefined;
  }
  const userHandle = value.response.userHandle;
  if (userHandle !== undefined && userHandle !== null && typeof userHandle !== 'string') {
    return undefined;
  }
  const extensionResults = value.clientExtensionResults;
  if (extensionResults !== undefined && !isRecord(extensionResults)) return undefined;

  return {
    id: value.id,
    rawId: value.rawId,
    response: {
      clientDataJSON: value.response.clientDataJSON,
      authenticatorData: value.response.authenticatorData,
      signature: value.response.signature,
      ...(userHandle === undefined ? {} : { userHandle }),
    },
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    ...(extensionResults === undefined ? {} : { clientExtensionResults: { ...extensionResults } }),
    type: 'public-key',
  };
}

function requestOptions(
  options: NativePasskeyOptions,
  settings: NativeSignInSettings,
): NativePasskeyRequestOptions | undefined {
  if (!settings.passkeyRpId || options.rpId !== settings.passkeyRpId) return undefined;
  return {
    challenge: options.challenge,
    rpId: options.rpId,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.allowCredentials === undefined
      ? {}
      : {
          allowCredentials: options.allowCredentials.map((credential) => {
            const transports = credential.transports?.filter(isPasskeyTransport);
            return {
              type: 'public-key',
              id: credential.id,
              ...(transports === undefined ? {} : { transports }),
            };
          }),
        }),
    ...(options.userVerification === undefined
      ? {}
      : { userVerification: options.userVerification }),
  };
}

export function createPasskeySignInPort(
  platform: NativeSignInPlatform,
  module: NativePasskeysApi | undefined,
  settings: NativeSignInSettings,
  lease: NativePromptLease = createNativePromptLease(),
): PasskeyPort {
  let pendingAvailability: Promise<boolean> | undefined;
  const available = (): Promise<boolean> => {
    if (!isNativePlatform(platform) || !settings.passkeyRpId || !module)
      return Promise.resolve(false);
    if (pendingAvailability) return pendingAvailability;
    const pending = Promise.resolve()
      .then(() => module.isSupported())
      .catch(() => false)
      .finally(() => {
        if (pendingAvailability === pending) pendingAvailability = undefined;
      });
    pendingAvailability = pending;
    return pending;
  };

  return {
    available,

    async authenticate(options: NativePasskeyOptions, signal: AbortSignalPort) {
      const request = requestOptions(options, settings);
      if (!request) return promptFailure('invalidResponse');
      if (signal.aborted) return { kind: 'cancelled' };
      if (!module) return { kind: 'unavailable' };
      if (!(await available())) return { kind: 'unavailable' };

      return lease.run<unknown, NativePasskeyAssertion>(
        signal,
        () => module.get(request),
        (value) => {
          if (value === null) return { kind: 'cancelled' };
          const credential = assertion(value);
          return credential === undefined
            ? promptFailure('invalidResponse')
            : { kind: 'success', value: credential };
        },
        (error) =>
          errorHasCode(error, PASSKEY_CANCEL_CODES) ? { kind: 'cancelled' } : promptFailure('sdk'),
      );
    },
  };
}
