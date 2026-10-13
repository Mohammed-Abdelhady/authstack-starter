import { NATIVE_AUTH_LIMITS } from '@app/core';
import { requireArray, requireObject } from '../shapes';
import type { NativePasskeyCredentialDescriptor, NativePasskeyOptions } from '../types/native-auth';
import { boundedString, boundedStringList, exactKeys, fail } from './validation';

function parsePasskeyDescriptor(
  value: unknown,
  field: string,
  status: number,
): NativePasskeyCredentialDescriptor {
  const descriptor = requireObject(value, field, status);
  exactKeys(descriptor, ['type', 'id', 'transports'], field, status);
  if (descriptor.type !== 'public-key') fail(status, `${field}.type`, 'is not public-key');
  return {
    type: 'public-key',
    id: boundedString(descriptor.id, `${field}.id`, NATIVE_AUTH_LIMITS.PASSKEY_FIELD, status),
    ...(descriptor.transports === undefined
      ? {}
      : {
          transports: boundedStringList(
            descriptor.transports,
            `${field}.transports`,
            NATIVE_AUTH_LIMITS.PROVIDER_NAME,
            NATIVE_AUTH_LIMITS.FACTOR_COUNT,
            status,
          ),
        }),
  };
}

export function parsePasskeyOptions(data: unknown, status: number): NativePasskeyOptions {
  const options = requireObject(data, 'data', status);
  exactKeys(
    options,
    ['challenge', 'timeout', 'rpId', 'allowCredentials', 'userVerification'],
    'data',
    status,
  );
  if (
    options.userVerification !== undefined &&
    options.userVerification !== 'required' &&
    options.userVerification !== 'preferred' &&
    options.userVerification !== 'discouraged'
  ) {
    fail(status, 'userVerification', 'is not supported');
  }
  let timeout: number | undefined;
  if (options.timeout !== undefined) {
    if (
      typeof options.timeout !== 'number' ||
      !Number.isInteger(options.timeout) ||
      options.timeout < 1 ||
      options.timeout > NATIVE_AUTH_LIMITS.PASSKEY_TIMEOUT_MS
    ) {
      fail(status, 'timeout', 'is outside its bounds');
    }
    timeout = options.timeout;
  }
  const descriptors =
    options.allowCredentials === undefined
      ? undefined
      : requireArray(options.allowCredentials, 'allowCredentials', status).map((item, index) =>
          parsePasskeyDescriptor(item, `allowCredentials[${index}]`, status),
        );
  if (
    descriptors !== undefined &&
    descriptors.length > NATIVE_AUTH_LIMITS.PASSKEY_CREDENTIAL_COUNT
  ) {
    fail(status, 'allowCredentials', 'has too many items');
  }
  return {
    challenge: boundedString(
      options.challenge,
      'challenge',
      NATIVE_AUTH_LIMITS.PASSKEY_FIELD,
      status,
    ),
    ...(timeout === undefined ? {} : { timeout }),
    ...(options.rpId === undefined
      ? {}
      : { rpId: boundedString(options.rpId, 'rpId', NATIVE_AUTH_LIMITS.PROVIDER_NAME, status) }),
    ...(descriptors === undefined ? {} : { allowCredentials: descriptors }),
    ...(options.userVerification === undefined
      ? {}
      : { userVerification: options.userVerification }),
  };
}
