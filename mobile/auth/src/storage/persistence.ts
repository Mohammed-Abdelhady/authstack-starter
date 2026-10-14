import type {
  ParsedAuthRecord,
  ParsedAuthTransaction,
  ParsedNativeAttempt,
  ParsedStoredTokens,
} from '../types/record-json';
import {
  AUTH_SCHEMA_VERSION,
  BROWSER_AUTHORIZATION_TIMEOUT_MS,
  NATIVE_ATTEMPT_LIFETIME_MS,
} from '../constants';
import { base64UrlEncode, utf8Bytes } from '../proof/encoding';
import type { AuthConfiguration, CryptoPort } from '../types/auth';
import type {
  AuthTransaction,
  NativePendingAttempt,
  PendingAuthRecord,
  StoredAuthRecord,
  StoredTokens,
} from '../types/record';

export async function digestInstallIdentity(
  id: string,
  clientId: string,
  crypto: Pick<CryptoPort, 'sha256'>,
): Promise<string> {
  const digest = await crypto.sha256(utf8Bytes(`${id}\u0000${clientId}`));
  if (digest.length !== 32) throw new TypeError('SHA-256 must return 32 bytes');
  return base64UrlEncode(digest);
}

export function makeRecord(
  configuration: AuthConfiguration,
  installDigest: string,
): PendingAuthRecord {
  return {
    schemaVersion: AUTH_SCHEMA_VERSION,
    serverBaseAddress: configuration.serverBaseAddress,
    environment: configuration.environment,
    clientId: configuration.clientId,
    installDigest,
  };
}

export function parseStoredRecord(value: string): StoredAuthRecord | undefined {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isObject(input)) return undefined;
  const parsed: ParsedAuthRecord = input;
  if (
    !isString(parsed.serverBaseAddress) ||
    !isString(parsed.environment) ||
    !isString(parsed.clientId) ||
    !isString(parsed.installDigest) ||
    (parsed.lineageId !== undefined && !isString(parsed.lineageId)) ||
    (parsed.proofKeyThumbprint !== undefined && !isString(parsed.proofKeyThumbprint)) ||
    typeof parsed.schemaVersion !== 'number' ||
    !Number.isInteger(parsed.schemaVersion)
  ) {
    return undefined;
  }
  const transaction = readTransaction(parsed.transaction);
  const nativeAttempt = readNativeAttempt(parsed.nativeAttempt);
  const tokens = readTokens(parsed.tokens);
  if (transaction === null || tokens === null || nativeAttempt === null) return undefined;
  if ((nativeAttempt !== undefined) !== (transaction?.kind === 'native')) return undefined;
  if (parsed.authorizationOperationId !== undefined && !isString(parsed.authorizationOperationId))
    return undefined;
  if (parsed.refreshInFlight !== undefined && typeof parsed.refreshInFlight !== 'boolean')
    return undefined;
  if (transaction !== undefined && tokens !== undefined) return undefined;
  if (nativeAttempt !== undefined && tokens !== undefined) return undefined;
  if (parsed.refreshInFlight === true && tokens === undefined) return undefined;
  if (tokens !== undefined && parsed.authorizationOperationId !== undefined) return undefined;
  const fields = {
    schemaVersion: parsed.schemaVersion,
    serverBaseAddress: parsed.serverBaseAddress,
    environment: parsed.environment,
    clientId: parsed.clientId,
    installDigest: parsed.installDigest,
  };
  if (tokens !== undefined) {
    const tokenFields = {
      ...fields,
      tokens,
      ...(isString(parsed.proofKeyThumbprint)
        ? { proofKeyThumbprint: parsed.proofKeyThumbprint }
        : {}),
      ...(parsed.refreshInFlight === undefined ? {} : { refreshInFlight: parsed.refreshInFlight }),
    };
    if (isString(parsed.lineageId)) return { ...tokenFields, lineageId: parsed.lineageId };
    return tokenFields;
  }
  if (parsed.lineageId !== undefined) return undefined;
  if (parsed.proofKeyThumbprint !== undefined) return undefined;
  return {
    ...fields,
    ...(isString(parsed.authorizationOperationId)
      ? { authorizationOperationId: parsed.authorizationOperationId }
      : {}),
    ...(transaction === undefined ? {} : { transaction }),
    ...(nativeAttempt === undefined ? {} : { nativeAttempt }),
  };
}

export function recordMatches(
  record: StoredAuthRecord,
  configuration: AuthConfiguration,
  installDigest: string,
): boolean {
  return (
    record.schemaVersion === AUTH_SCHEMA_VERSION &&
    record.serverBaseAddress === configuration.serverBaseAddress &&
    record.environment === configuration.environment &&
    record.clientId === configuration.clientId &&
    constantTimeEqual(record.installDigest, installDigest)
  );
}

export function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function transactionExpired(transaction: AuthTransaction, wallTime: number): boolean {
  if (
    wallTime < transaction.createdAt ||
    transaction.expiresAt < transaction.createdAt ||
    transaction.expiresAt - transaction.createdAt >
      (transaction.kind === 'native'
        ? NATIVE_ATTEMPT_LIFETIME_MS
        : BROWSER_AUTHORIZATION_TIMEOUT_MS)
  ) {
    return true;
  }
  return wallTime > transaction.expiresAt;
}

function readTransaction(input: unknown): AuthTransaction | null | undefined {
  if (input === undefined) return undefined;
  if (!isObject(input)) return null;
  const value: ParsedAuthTransaction = input;
  if (
    !isString(value.verifier) ||
    !isString(value.state) ||
    !isString(value.returnAddress) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt) ||
    !isString(value.operationId) ||
    (value.kind !== undefined && value.kind !== 'native')
  )
    return null;
  return {
    verifier: value.verifier,
    state: value.state,
    returnAddress: value.returnAddress,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    operationId: value.operationId,
    ...(value.kind === 'native' ? { kind: value.kind } : {}),
  };
}

function readNativeAttempt(input: unknown): NativePendingAttempt | null | undefined {
  if (input === undefined) return undefined;
  if (!isObject(input)) return null;
  const value: ParsedNativeAttempt = input;
  if (
    !isString(value.id) ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    !isString(value.secret) ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.secret) ||
    !isString(value.nonceDigest) ||
    !/^[a-f0-9]{64}$/.test(value.nonceDigest) ||
    (value.flow !== 'signIn' && value.flow !== 'registration' && value.flow !== 'recovery') ||
    (value.activationCompleted !== undefined && value.activationCompleted !== true)
  )
    return null;
  return {
    id: value.id,
    secret: value.secret,
    nonceDigest: value.nonceDigest,
    flow: value.flow,
    ...(value.activationCompleted === true ? { activationCompleted: true } : {}),
  };
}

function readTokens(input: unknown): StoredTokens | null | undefined {
  if (input === undefined) return undefined;
  if (!isObject(input)) return null;
  const value: ParsedStoredTokens = input;
  if (!isString(value.refreshToken)) return null;
  return { refreshToken: value.refreshToken };
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
