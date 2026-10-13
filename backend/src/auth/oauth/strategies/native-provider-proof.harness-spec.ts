import { SignJWT, type JWTPayload } from 'jose';
import type { NativeProviderMethod } from '@app/sdk';
import {
  createSigningKey,
  type SigningKey,
} from './oauth-strategy.harness-spec';

export const NATIVE_NONCE = 'a'.repeat(64);
export const NATIVE_AUDIENCE = 'native-client';
export const NATIVE_SUBJECT = 'native-provider-subject';
export const NATIVE_EMAIL = 'native-provider@example.test';
export const NATIVE_NOW = new Date('2026-10-12T12:00:00Z');

export const NATIVE_METHOD = {
  google: {
    id: 'google',
    displayName: 'Google',
    mode: 'googleIdentityToken',
    sdk: { kind: 'google', webClientId: NATIVE_AUDIENCE },
  },
  apple: {
    id: 'apple',
    displayName: 'Apple',
    mode: 'appleIdentityTokenAndCode',
    sdk: { kind: 'apple', appId: NATIVE_AUDIENCE },
  },
  facebook: {
    id: 'facebook',
    displayName: 'Facebook',
    mode: 'facebook',
    sdk: { kind: 'facebook', appId: NATIVE_AUDIENCE },
  },
} as const satisfies Record<string, NativeProviderMethod>;

export async function signedNativeToken(
  key: SigningKey,
  issuer: string,
  overrides: JWTPayload = {},
  omitted: string[] = [],
) {
  const claims: JWTPayload = {
    iss: issuer,
    aud: NATIVE_AUDIENCE,
    sub: NATIVE_SUBJECT,
    iat: NATIVE_NOW.getTime() / 1000,
    exp: NATIVE_NOW.getTime() / 1000 + 600,
    nonce: NATIVE_NONCE,
    email: NATIVE_EMAIL,
    email_verified: true,
    ...overrides,
  };
  for (const name of omitted) delete claims[name];
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-signing-key' })
    .sign(key.privateKey);
}

export { createSigningKey };
