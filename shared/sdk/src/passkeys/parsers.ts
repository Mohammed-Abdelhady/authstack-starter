import { NATIVE_AUTH_LIMITS } from '@app/core';
import { HTTP_STATUS_OK } from '../constants';
import { isJsonObject, unwrapEnvelope, unwrapEnvelopeBody } from '../envelope';
import { boundedString, booleanValue, fail, isoDate } from '../native-auth/validation';
import { requireArray, requireObject } from '../shapes';
import type { TransportResponse } from '../transport';
import type { JsonFields } from '../types/json';
import type {
  PasskeyCreationOptions,
  PasskeyCredentialDescriptorJson,
  PasskeyList,
  PasskeySummary,
  PasskeyUserVerification,
} from '../types/passkeys';

type Selection = NonNullable<PasskeyCreationOptions['authenticatorSelection']>;

const USER_VERIFICATION: readonly PasskeyUserVerification[] = [
  'required',
  'preferred',
  'discouraged',
];
const ATTACHMENTS: readonly NonNullable<Selection['authenticatorAttachment']>[] = [
  'platform',
  'cross-platform',
];
const RESIDENT_KEYS: readonly NonNullable<Selection['residentKey']>[] = [
  'discouraged',
  'preferred',
  'required',
];
const ATTESTATIONS: readonly NonNullable<PasskeyCreationOptions['attestation']>[] = [
  'none',
  'indirect',
  'direct',
  'enterprise',
];

/** `value` when it is one of `allowed`, refused otherwise; absent stays absent. */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  status: number,
): T | undefined {
  if (value === undefined) return undefined;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) fail(status, field, 'is not supported');
  return match;
}

function readSummary(value: unknown, field: string, status: number): PasskeySummary {
  const summary: JsonFields<PasskeySummary> = requireObject(value, field, status);
  const deviceType =
    summary.deviceType === undefined
      ? undefined
      : boundedString(summary.deviceType, `${field}.deviceType`, NATIVE_AUTH_LIMITS.NAME, status);
  return {
    id: boundedString(summary.id, `${field}.id`, NATIVE_AUTH_LIMITS.ATTEMPT_ID, status),
    name: boundedString(summary.name, `${field}.name`, NATIVE_AUTH_LIMITS.NAME, status),
    ...(deviceType === undefined ? {} : { deviceType }),
    backedUp: booleanValue(summary.backedUp, `${field}.backedUp`, status),
    createdAt: isoDate(summary.createdAt, `${field}.createdAt`, status),
    lastUsedAt:
      summary.lastUsedAt === null
        ? null
        : isoDate(summary.lastUsedAt, `${field}.lastUsedAt`, status),
  };
}

function readList(data: unknown, status: number): PasskeyList {
  const list: JsonFields<PasskeyList> = requireObject(data, 'data', status);
  const passkeys = requireArray(list.passkeys, 'data.passkeys', status).map((item, index) =>
    readSummary(item, `data.passkeys[${index}]`, status),
  );
  return {
    passkeys,
    ...(list.canRemove === undefined
      ? {}
      : { canRemove: booleanValue(list.canRemove, 'data.canRemove', status) }),
  };
}

function readDescriptor(
  value: unknown,
  field: string,
  status: number,
): PasskeyCredentialDescriptorJson {
  const descriptor: JsonFields<PasskeyCredentialDescriptorJson> = requireObject(
    value,
    field,
    status,
  );
  if (descriptor.type !== 'public-key') fail(status, `${field}.type`, 'is not public-key');
  const transports =
    descriptor.transports === undefined
      ? undefined
      : requireArray(descriptor.transports, `${field}.transports`, status).map((item, index) =>
          boundedString(
            item,
            `${field}.transports[${index}]`,
            NATIVE_AUTH_LIMITS.PROVIDER_NAME,
            status,
          ),
        );
  return {
    type: 'public-key',
    id: boundedString(descriptor.id, `${field}.id`, NATIVE_AUTH_LIMITS.PASSKEY_FIELD, status),
    ...(transports === undefined ? {} : { transports }),
  };
}

function boundedList<T>(
  value: unknown,
  field: string,
  status: number,
  read: (item: unknown, itemField: string) => T,
): T[] {
  const items = requireArray(value, field, status);
  if (items.length > NATIVE_AUTH_LIMITS.PASSKEY_CREDENTIAL_COUNT) {
    fail(status, field, 'has too many items');
  }
  return items.map((item, index) => read(item, `${field}[${index}]`));
}

function readAlgorithm(value: unknown, field: string, status: number) {
  const parameter: { type?: unknown; alg?: unknown } = requireObject(value, field, status);
  if (parameter.type !== 'public-key') fail(status, `${field}.type`, 'is not public-key');
  if (typeof parameter.alg !== 'number' || !Number.isInteger(parameter.alg)) {
    fail(status, `${field}.alg`, 'is not an integer');
  }
  return { type: 'public-key' as const, alg: parameter.alg };
}

function readSelection(value: unknown, status: number): Selection {
  const selection: JsonFields<Selection> = requireObject(value, 'authenticatorSelection', status);
  const field = 'authenticatorSelection';
  const attachment = oneOf(
    selection.authenticatorAttachment,
    ATTACHMENTS,
    `${field}.authenticatorAttachment`,
    status,
  );
  const residentKey = oneOf(selection.residentKey, RESIDENT_KEYS, `${field}.residentKey`, status);
  const verification = oneOf(
    selection.userVerification,
    USER_VERIFICATION,
    `${field}.userVerification`,
    status,
  );
  return {
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
    ...(residentKey === undefined ? {} : { residentKey }),
    ...(selection.requireResidentKey === undefined
      ? {}
      : {
          requireResidentKey: booleanValue(
            selection.requireResidentKey,
            `${field}.requireResidentKey`,
            status,
          ),
        }),
    ...(verification === undefined ? {} : { userVerification: verification }),
  };
}

function readTimeout(value: unknown, status: number): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > NATIVE_AUTH_LIMITS.PASSKEY_TIMEOUT_MS
  ) {
    fail(status, 'timeout', 'is outside its bounds');
  }
  return value;
}

/** Fields the prompt needs. Others the server adds are left behind, not forwarded. */
function readCreationOptions(data: unknown, status: number): PasskeyCreationOptions {
  const options: JsonFields<PasskeyCreationOptions> = requireObject(data, 'data', status);
  const rp: { id?: unknown; name?: unknown } = requireObject(options.rp, 'rp', status);
  const user: { id?: unknown; name?: unknown; displayName?: unknown } = requireObject(
    options.user,
    'user',
    status,
  );
  const timeout = readTimeout(options.timeout, status);
  const attestation = oneOf(options.attestation, ATTESTATIONS, 'attestation', status);
  const credProps = isJsonObject(options.extensions) ? options.extensions['credProps'] : undefined;
  return {
    challenge: boundedString(
      options.challenge,
      'challenge',
      NATIVE_AUTH_LIMITS.PASSKEY_FIELD,
      status,
    ),
    rp: {
      id: boundedString(rp.id, 'rp.id', NATIVE_AUTH_LIMITS.PROVIDER_NAME, status),
      name: boundedString(rp.name, 'rp.name', NATIVE_AUTH_LIMITS.PROVIDER_NAME, status),
    },
    user: {
      id: boundedString(user.id, 'user.id', NATIVE_AUTH_LIMITS.PASSKEY_FIELD, status),
      name: boundedString(user.name, 'user.name', NATIVE_AUTH_LIMITS.EMAIL, status),
      displayName: boundedString(
        user.displayName,
        'user.displayName',
        NATIVE_AUTH_LIMITS.EMAIL,
        status,
      ),
    },
    pubKeyCredParams: boundedList(options.pubKeyCredParams, 'pubKeyCredParams', status, (item, f) =>
      readAlgorithm(item, f, status),
    ),
    ...(timeout === undefined ? {} : { timeout }),
    ...(options.excludeCredentials === undefined
      ? {}
      : {
          excludeCredentials: boundedList(
            options.excludeCredentials,
            'excludeCredentials',
            status,
            (item, f) => readDescriptor(item, f, status),
          ),
        }),
    ...(options.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: readSelection(options.authenticatorSelection, status) }),
    ...(attestation === undefined ? {} : { attestation }),
    ...(typeof credProps === 'boolean' ? { extensions: { credProps } } : {}),
  };
}

/** The reply of GET /api/auth/passkeys. */
export function unwrapPasskeyList(response: TransportResponse): PasskeyList {
  return readList(unwrapEnvelope<unknown>(response), response.status);
}

/** The same for a body whose response already passed as successful. */
export function unwrapPasskeyListBody(body: unknown): PasskeyList {
  return readList(unwrapEnvelopeBody<unknown>(body), HTTP_STATUS_OK);
}

/** The reply of a rename or a registration: the passkey as it is now stored. */
export function unwrapPasskeySummary(response: TransportResponse): PasskeySummary {
  return readSummary(unwrapEnvelope<unknown>(response), 'data', response.status);
}

/** The reply of POST /api/auth/native/passkeys/register/options. */
export function unwrapPasskeyCreationOptions(response: TransportResponse): PasskeyCreationOptions {
  return readCreationOptions(unwrapEnvelope<unknown>(response), response.status);
}
