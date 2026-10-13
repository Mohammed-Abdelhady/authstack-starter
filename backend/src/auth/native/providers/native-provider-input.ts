import type { NativeProviderCredential } from '@app/sdk';
import { invalidRequest } from '../utils/native-attempt-errors';

const TOKEN_LIMIT = 16_384;
const CODE_LIMIT = 64;
const NONCE_PATTERN = /^[a-f0-9]{64}$/u;

export function nativeProviderInput(input: unknown): NativeProviderCredential {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw invalidRequest();
  const value = input as Record<string, unknown>;
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
