import type { NativeProviderCredential } from '@app/sdk';
import { invalidRequest } from '../utils/native-attempt-errors';
import { LANGUAGE_TAG_MAX_LENGTH } from '../../../common/constants/locales';

const TOKEN_LIMIT = 16_384;
const CODE_LIMIT = 64;
const NONCE_PATTERN = /^[a-f0-9]{64}$/u;

function isBody(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * The body without its optional `locale`, which the request's language reader
 * takes. Like every sign-up body, any text tag up to the limit is accepted and
 * one this build lacks falls through later; anything else is refused.
 */
function credentialFields(input: unknown): Record<string, unknown> {
  if (!isBody(input)) throw invalidRequest();
  const { locale, ...fields } = input;
  if (
    locale !== undefined &&
    (typeof locale !== 'string' || locale.length > LANGUAGE_TAG_MAX_LENGTH)
  )
    throw invalidRequest();
  return fields;
}

export function nativeProviderInput(input: unknown): NativeProviderCredential {
  const value = credentialFields(input);
  const string = (field: string, limit = TOKEN_LIMIT): string => {
    const item = value[field];
    if (typeof item !== 'string' || !item.trim() || item.length > limit)
      throw invalidRequest();
    return item;
  };
  const exact = (keys: string[]) => {
    if (Object.keys(value).some((key) => !keys.includes(key)))
      throw invalidRequest();
  };
  if (value.kind === 'facebookAccessToken') {
    exact(['kind', 'accessToken']);
    return { kind: value.kind, accessToken: string('accessToken') };
  }
  const nonceDigest = string('nonceDigest');
  if (!NONCE_PATTERN.test(nonceDigest)) throw invalidRequest();
  switch (value.kind) {
    case 'googleIdentityToken':
      exact(['kind', 'identityToken', 'nonceDigest']);
      return {
        kind: value.kind,
        identityToken: string('identityToken'),
        nonceDigest,
      };
    case 'appleIdentityTokenAndCode':
      exact(['kind', 'identityToken', 'authorizationCode', 'nonceDigest']);
      return {
        kind: value.kind,
        identityToken: string('identityToken'),
        authorizationCode: string('authorizationCode', CODE_LIMIT),
        nonceDigest,
      };
    case 'facebookLimitedToken':
      exact(['kind', 'authenticationToken', 'nonceDigest']);
      return {
        kind: value.kind,
        authenticationToken: string('authenticationToken'),
        nonceDigest,
      };
    default:
      throw invalidRequest();
  }
}
