import type {
  NativePasskeyAssertion,
  NativePasskeyOptions,
  PasskeyAttestation,
  PasskeyCreationOptions,
} from '@app/sdk';
import type { AbortSignalPort, NativeRegistrationResult, PasskeyPort } from '@app/native-auth';
import type {
  NativePasskeysApi,
  NativePasskeyRequestOptions,
  NativeSignInPlatform,
  NativeSignInSettings,
} from '../types/sign-in-modules';
import {
  attestation,
  creationRequest,
  isExcludedCredentialError,
  isPasskeyTransport,
} from '../logic/passkey-attestation';
import { createNativePromptLease, type NativePromptLease } from '../logic/prompt-lease';
import {
  errorHasCode,
  isRecord,
  nonEmptyString,
  promptFailure,
} from '../logic/native-sign-in-values';

/**
 * How the module says this device cannot make a passkey although it passed
 * the availability check: Android's message (its check reads only the API
 * level), the code Expo gives iOS's NotSupportedException, and the web name.
 */
const PASSKEY_NOT_SUPPORTED_CODES = ['NotSupported', 'ERR_NOT_SUPPORTED', 'NotSupportedError'];
const PASSKEY_CANCEL_CODES = [
  'ERR_REQUEST_CANCELED',
  'NotAllowedError',
  'UserCancelled',
  'UserCancelledException',
];

interface PasskeyAssertionFields {
  type?: unknown;
  id?: unknown;
  rawId?: unknown;
  response?: unknown;
  authenticatorAttachment?: unknown;
  clientExtensionResults?: unknown;
}

interface PasskeyResponseFields {
  clientDataJSON?: unknown;
  authenticatorData?: unknown;
  signature?: unknown;
  userHandle?: unknown;
}

function isNativePlatform(platform: NativeSignInPlatform): boolean {
  return platform === 'ios' || platform === 'android';
}

function assertionResponse(value: unknown): NativePasskeyAssertion['response'] | undefined {
  if (!isRecord(value)) return undefined;
  const response: PasskeyResponseFields = value;
  if (
    !nonEmptyString(response.clientDataJSON) ||
    !nonEmptyString(response.authenticatorData) ||
    !nonEmptyString(response.signature)
  ) {
    return undefined;
  }

  const userHandle = response.userHandle;
  if (userHandle !== undefined && userHandle !== null && typeof userHandle !== 'string') {
    return undefined;
  }
  return {
    clientDataJSON: response.clientDataJSON,
    authenticatorData: response.authenticatorData,
    signature: response.signature,
    ...(userHandle === undefined ? {} : { userHandle }),
  };
}

function assertionOptionalFields(
  fields: PasskeyAssertionFields,
): Pick<NativePasskeyAssertion, 'authenticatorAttachment' | 'clientExtensionResults'> | undefined {
  const attachment = fields.authenticatorAttachment ?? undefined;
  if (attachment !== undefined && attachment !== 'platform' && attachment !== 'cross-platform') {
    return undefined;
  }
  const extensionResults = fields.clientExtensionResults ?? undefined;
  if (extensionResults !== undefined && !isRecord(extensionResults)) return undefined;
  return {
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    ...(extensionResults === undefined ? {} : { clientExtensionResults: { ...extensionResults } }),
  };
}

function assertion(value: unknown): NativePasskeyAssertion | undefined {
  if (!isRecord(value)) return undefined;
  const fields: PasskeyAssertionFields = value;
  if (fields.type !== 'public-key' || !nonEmptyString(fields.id) || !nonEmptyString(fields.rawId)) {
    return undefined;
  }
  const response = assertionResponse(fields.response);
  if (!response) return undefined;
  const optional = assertionOptionalFields(fields);
  if (!optional) return undefined;
  return {
    id: fields.id,
    rawId: fields.rawId,
    response,
    ...optional,
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

  const port: PasskeyPort = {
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

  // Only a module that can create passkeys gets a registration prompt.
  const create = module?.create?.bind(module);
  if (create === undefined) return port;

  const register = async (
    options: PasskeyCreationOptions,
    signal: AbortSignalPort,
  ): Promise<NativeRegistrationResult<PasskeyAttestation>> => {
    const request = creationRequest(options, settings);
    if (!request) return promptFailure('invalidResponse');
    if (signal.aborted) return { kind: 'cancelled' };
    if (!(await available())) return { kind: 'unavailable' };

    // An excluded credential is told apart inside the failure branch, so the
    // lease keeps its one prompt at a time and its cancel handling.
    const failure = { excluded: false };
    const result = await lease.run<unknown, PasskeyAttestation>(
      signal,
      () => create(request),
      (value) => {
        if (value === null) return { kind: 'cancelled' };
        const made = attestation(value);
        return made === undefined
          ? promptFailure('invalidResponse')
          : { kind: 'success', value: made };
      },
      (error) => {
        if (errorHasCode(error, PASSKEY_CANCEL_CODES)) return { kind: 'cancelled' };
        if (errorHasCode(error, PASSKEY_NOT_SUPPORTED_CODES)) return { kind: 'unavailable' };
        failure.excluded = isExcludedCredentialError(error);
        return promptFailure('sdk');
      },
    );
    return failure.excluded ? { kind: 'excluded' } : result;
  };
  return { ...port, register };
}
