import type { PasskeyAttestation, PasskeyCreationOptions } from '@app/sdk';
import type {
  NativePasskeyCreationRequest,
  NativePasskeyTransport,
  NativeSignInSettings,
} from '../types/sign-in-modules';
import { isRecord, nonEmptyString } from './native-sign-in-values';

const PASSKEY_TRANSPORTS: readonly NativePasskeyTransport[] = [
  'ble',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];

/**
 * How an authenticator says it already holds an excluded credential: the DOM
 * name on the web, inside the module's message on Android. iOS reports it as
 * an unknown error in react-native-passkeys 0.4.2, so it reads as a failure.
 */
const EXCLUDED_CREDENTIAL_ERROR = 'InvalidStateError';

interface AttestationFields {
  type?: unknown;
  id?: unknown;
  rawId?: unknown;
  response?: unknown;
  authenticatorAttachment?: unknown;
  clientExtensionResults?: unknown;
}

interface AttestationResponseFields {
  clientDataJSON?: unknown;
  attestationObject?: unknown;
  transports?: unknown;
}

export function isPasskeyTransport(value: string): value is NativePasskeyTransport {
  return PASSKEY_TRANSPORTS.some((transport) => transport === value);
}

export function isExcludedCredentialError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const fields: { name?: unknown; message?: unknown } = error;
  return (
    fields.name === EXCLUDED_CREDENTIAL_ERROR ||
    (typeof fields.message === 'string' && fields.message.includes(EXCLUDED_CREDENTIAL_ERROR))
  );
}

/** The options the module takes, only for the relying party this build is set up for. */
export function creationRequest(
  options: PasskeyCreationOptions,
  settings: NativeSignInSettings,
): NativePasskeyCreationRequest | undefined {
  if (!settings.passkeyRpId || options.rp.id !== settings.passkeyRpId) return undefined;
  return {
    challenge: options.challenge,
    rp: { ...options.rp },
    user: { ...options.user },
    pubKeyCredParams: options.pubKeyCredParams.map((parameter) => ({ ...parameter })),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.excludeCredentials === undefined
      ? {}
      : {
          excludeCredentials: options.excludeCredentials.map((credential) => {
            const transports = credential.transports?.filter(isPasskeyTransport);
            return {
              type: 'public-key' as const,
              id: credential.id,
              ...(transports === undefined ? {} : { transports }),
            };
          }),
        }),
    ...(options.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: { ...options.authenticatorSelection } }),
    ...(options.attestation === undefined ? {} : { attestation: options.attestation }),
    ...(options.extensions === undefined ? {} : { extensions: { ...options.extensions } }),
  };
}

function attestationResponse(value: unknown): PasskeyAttestation['response'] | undefined {
  if (!isRecord(value)) return undefined;
  const response: AttestationResponseFields = value;
  if (!nonEmptyString(response.clientDataJSON) || !nonEmptyString(response.attestationObject)) {
    return undefined;
  }
  const transports = Array.isArray(response.transports)
    ? response.transports.filter((item): item is string => typeof item === 'string')
    : undefined;
  return {
    clientDataJSON: response.clientDataJSON,
    attestationObject: response.attestationObject,
    ...(transports === undefined ? {} : { transports }),
  };
}

/**
 * What the module made, as the verify route takes it. The module's own extras,
 * a public key reader among them, are left behind.
 */
export function attestation(value: unknown): PasskeyAttestation | undefined {
  if (!isRecord(value)) return undefined;
  const fields: AttestationFields = value;
  if (fields.type !== 'public-key' || !nonEmptyString(fields.id) || !nonEmptyString(fields.rawId)) {
    return undefined;
  }
  const response = attestationResponse(fields.response);
  if (!response) return undefined;
  const attachment = fields.authenticatorAttachment ?? undefined;
  if (attachment !== undefined && attachment !== 'platform' && attachment !== 'cross-platform') {
    return undefined;
  }
  const extensionResults = fields.clientExtensionResults ?? undefined;
  if (extensionResults !== undefined && !isRecord(extensionResults)) return undefined;
  return {
    id: fields.id,
    rawId: fields.rawId,
    type: 'public-key',
    response,
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    ...(extensionResults === undefined ? {} : { clientExtensionResults: { ...extensionResults } }),
  };
}
