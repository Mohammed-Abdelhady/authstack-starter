import { createHash, timingSafeEqual } from 'node:crypto';
import type { NativePasskeyAssertion } from '@app/sdk';
import type { NativeAttempt } from '../../types/native-attempt';
import { NATIVE_FACTOR_INPUT_LIMIT } from '../constants/native-factor-input';

export function digest(
  attempt: NativeAttempt,
  purpose: string,
  userId: string,
  challenge: string,
): string {
  return createHash('sha256')
    .update(
      [attempt.secretHash, attempt.attemptId, purpose, userId, challenge].join(
        ':',
      ),
    )
    .digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertHandle(
  handle: string | null | undefined,
  userId: string,
  purpose: string,
): boolean {
  if (!handle) return purpose === 'secondFactor';
  return Buffer.from(handle, 'base64url').toString('utf8') === userId;
}

export function isAssertion(input: unknown): input is NativePasskeyAssertion {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'id',
          'rawId',
          'type',
          'response',
          'authenticatorAttachment',
          'clientExtensionResults',
        ].includes(key),
    )
  )
    return false;
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > NATIVE_FACTOR_INPUT_LIMIT.PASSKEY_FIELD ||
    typeof value.rawId !== 'string' ||
    value.rawId !== value.id ||
    value.type !== 'public-key' ||
    !value.response ||
    typeof value.response !== 'object' ||
    Array.isArray(value.response) ||
    (value.authenticatorAttachment !== undefined &&
      value.authenticatorAttachment !== 'platform' &&
      value.authenticatorAttachment !== 'cross-platform') ||
    (value.clientExtensionResults !== undefined &&
      (typeof value.clientExtensionResults !== 'object' ||
        value.clientExtensionResults === null ||
        Array.isArray(value.clientExtensionResults)))
  )
    return false;
  const response = value.response as Record<string, unknown>;
  if (
    Object.keys(response).some(
      (key) =>
        ![
          'clientDataJSON',
          'authenticatorData',
          'signature',
          'userHandle',
        ].includes(key),
    )
  )
    return false;
  if (
    response.userHandle !== undefined &&
    response.userHandle !== null &&
    (typeof response.userHandle !== 'string' ||
      response.userHandle.length > NATIVE_FACTOR_INPUT_LIMIT.PASSKEY_FIELD)
  )
    return false;
  return ['clientDataJSON', 'authenticatorData', 'signature'].every(
    (name) =>
      typeof response[name] === 'string' &&
      response[name].length > 0 &&
      response[name].length <= NATIVE_FACTOR_INPUT_LIMIT.PASSKEY_FIELD,
  );
}
