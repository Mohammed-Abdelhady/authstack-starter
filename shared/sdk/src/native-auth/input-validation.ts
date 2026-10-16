import {
  NATIVE_AUTH_FLOW,
  NATIVE_AUTH_LIMITS,
  NATIVE_AUTH_PATTERN,
  NATIVE_PROVIDER_CREDENTIAL_KIND,
} from '@app/core';
import type {
  NativeAttemptStart,
  NativeEmailCodeRequestInput, // feature:email-code
  NativeEmailCodeVerificationInput, // feature:email-code
  NativePasskeyAssertion,
  NativeProviderCredential,
} from '../types/native-auth';
import { normalizeNativeName } from './name';

export function requireNativeName(value: string): string {
  const name = normalizeNativeName(value);
  if (name === undefined) throw new TypeError('name is outside its bounds');
  return name;
}

export function requireBoundedString(value: string, field: string, limit: number): void {
  if (value.length === 0 || value.trim().length === 0 || value.length > limit) {
    throw new TypeError(`${field} is outside its bounds`);
  }
}

export function requireKeys(value: object, keys: readonly string[], field: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`${field} has unsupported fields`);
  }
}

function requireAllowedKeys(value: object, keys: readonly string[], field: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`${field} has unsupported fields`);
  }
}

export function requireEmail(value: string): void {
  requireBoundedString(value, 'email', NATIVE_AUTH_LIMITS.EMAIL);
  if (!NATIVE_AUTH_PATTERN.EMAIL.test(value)) throw new TypeError('email has an invalid format');
}

export function requirePassword(value: string): void {
  requireBoundedString(value, 'password', NATIVE_AUTH_LIMITS.PASSWORD_BYTES);
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  if (bytes > NATIVE_AUTH_LIMITS.PASSWORD_BYTES) throw new TypeError('password is too long');
}

export function validateStart(input: NativeAttemptStart): void {
  requireKeys(
    input,
    ['clientId', 'redirectUri', 'codeChallenge', 'codeChallengeMethod', 'state', 'scopes', 'flow'],
    'attempt start',
  );
  requireBoundedString(input.clientId, 'client id', NATIVE_AUTH_LIMITS.CLIENT_ID);
  requireBoundedString(input.redirectUri, 'redirect uri', NATIVE_AUTH_LIMITS.REDIRECT_URI);
  requireBoundedString(
    input.codeChallenge,
    'code challenge',
    NATIVE_AUTH_LIMITS.ATTEMPT_SECRET_LENGTH,
  );
  if (!NATIVE_AUTH_PATTERN.BASE64URL_SHA256.test(input.codeChallenge)) {
    throw new TypeError('code challenge has an invalid format');
  }
  if (input.codeChallengeMethod !== 'S256')
    throw new TypeError('code challenge method is not supported');
  requireBoundedString(input.state, 'state', NATIVE_AUTH_LIMITS.STATE);
  if (
    input.flow !== NATIVE_AUTH_FLOW.SIGN_IN &&
    input.flow !== NATIVE_AUTH_FLOW.REGISTRATION &&
    input.flow !== NATIVE_AUTH_FLOW.RECOVERY
  ) {
    throw new TypeError('native flow is not supported');
  }
  if (!Array.isArray(input.scopes) || input.scopes.length > NATIVE_AUTH_LIMITS.SCOPE_COUNT) {
    throw new TypeError('scopes are outside their bounds');
  }
  for (const scope of input.scopes) requireBoundedString(scope, 'scope', NATIVE_AUTH_LIMITS.SCOPE);
}

export function validatePasskeyAssertion(input: NativePasskeyAssertion): void {
  requireAllowedKeys(
    input,
    ['id', 'rawId', 'response', 'authenticatorAttachment', 'clientExtensionResults', 'type'],
    'passkey assertion',
  );
  if (input.type !== 'public-key') throw new TypeError('passkey assertion type is not supported');
  requireBoundedString(input.id, 'passkey id', NATIVE_AUTH_LIMITS.PASSKEY_FIELD);
  requireBoundedString(input.rawId, 'passkey raw id', NATIVE_AUTH_LIMITS.PASSKEY_FIELD);
  requireAllowedKeys(
    input.response,
    ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle'],
    'passkey response',
  );
  requireBoundedString(
    input.response.clientDataJSON,
    'client data',
    NATIVE_AUTH_LIMITS.PASSKEY_FIELD,
  );
  requireBoundedString(
    input.response.authenticatorData,
    'authenticator data',
    NATIVE_AUTH_LIMITS.PASSKEY_FIELD,
  );
  requireBoundedString(
    input.response.signature,
    'passkey signature',
    NATIVE_AUTH_LIMITS.PASSKEY_FIELD,
  );
  if (input.response.userHandle !== undefined && input.response.userHandle !== null) {
    requireBoundedString(
      input.response.userHandle,
      'passkey user handle',
      NATIVE_AUTH_LIMITS.PASSKEY_FIELD,
    );
  }
}
export function validateProviderCredential(input: NativeProviderCredential): void {
  switch (input.kind) {
    case NATIVE_PROVIDER_CREDENTIAL_KIND.GOOGLE_IDENTITY_TOKEN:
      requireKeys(input, ['kind', 'identityToken', 'nonceDigest'], 'Google credential');
      requireBoundedString(input.identityToken, 'identity token', NATIVE_AUTH_LIMITS.TOKEN);
      requireBoundedString(
        input.nonceDigest,
        'nonce digest',
        NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.SHA256_HEX.test(input.nonceDigest))
        throw new TypeError('nonce digest has an invalid format');
      return;
    case NATIVE_PROVIDER_CREDENTIAL_KIND.APPLE_IDENTITY_TOKEN_AND_CODE:
      requireKeys(
        input,
        ['kind', 'identityToken', 'authorizationCode', 'nonceDigest'],
        'Apple credential',
      );
      requireBoundedString(input.identityToken, 'identity token', NATIVE_AUTH_LIMITS.TOKEN);
      requireBoundedString(input.authorizationCode, 'authorization code', NATIVE_AUTH_LIMITS.TOKEN);
      requireBoundedString(
        input.nonceDigest,
        'nonce digest',
        NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.SHA256_HEX.test(input.nonceDigest))
        throw new TypeError('nonce digest has an invalid format');
      return;
    case NATIVE_PROVIDER_CREDENTIAL_KIND.FACEBOOK_LIMITED_TOKEN:
      requireKeys(
        input,
        ['kind', 'authenticationToken', 'nonceDigest'],
        'Facebook limited credential',
      );
      requireBoundedString(
        input.authenticationToken,
        'authentication token',
        NATIVE_AUTH_LIMITS.TOKEN,
      );
      requireBoundedString(
        input.nonceDigest,
        'nonce digest',
        NATIVE_AUTH_LIMITS.PROVIDER_NONCE_DIGEST_LENGTH,
      );
      if (!NATIVE_AUTH_PATTERN.SHA256_HEX.test(input.nonceDigest))
        throw new TypeError('nonce digest has an invalid format');
      return;
    case NATIVE_PROVIDER_CREDENTIAL_KIND.FACEBOOK_ACCESS_TOKEN:
      requireKeys(input, ['kind', 'accessToken'], 'Facebook access credential');
      requireBoundedString(input.accessToken, 'access token', NATIVE_AUTH_LIMITS.TOKEN);
      return;
    default:
      throw new TypeError('provider credential kind is not supported');
  }
}

// feature:email-code:start
/** The longest language tag the server reads, its `LANGUAGE_TAG_MAX_LENGTH`. */
const LANGUAGE_TAG_LIMIT = 35;

function requireLanguageTag(locale: string | undefined): void {
  if (locale !== undefined) requireBoundedString(locale, 'locale', LANGUAGE_TAG_LIMIT);
}

export function validateEmailCodeRequest(input: NativeEmailCodeRequestInput): void {
  requireKeys(input, input.locale === undefined ? ['email'] : ['email', 'locale'], 'code request');
  requireEmail(input.email);
  requireLanguageTag(input.locale);
}

export function validateEmailCodeVerification(input: NativeEmailCodeVerificationInput): void {
  requireKeys(input, input.locale === undefined ? ['code'] : ['code', 'locale'], 'code check');
  requireBoundedString(input.code, 'email code', NATIVE_AUTH_LIMITS.ACTIVATION_CODE_LENGTH);
  if (!NATIVE_AUTH_PATTERN.ACTIVATION_CODE.test(input.code))
    throw new TypeError('email code has an invalid format');
  requireLanguageTag(input.locale);
}
// feature:email-code:end
