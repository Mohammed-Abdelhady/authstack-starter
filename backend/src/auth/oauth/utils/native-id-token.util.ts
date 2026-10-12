import type { OAuthProfile } from '../oauth-provider.interface';
import { nativeDisplayName } from '../../../common/utils/native-display-name';
import { verifyIdToken, type VerifyIdTokenOptions } from './id-token.util';

const NATIVE_REQUIRED_CLAIMS = ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce'];
const ISSUED_AT_TOLERANCE_SECONDS = 60;
const SUBJECT_LIMIT = 255;
const EMAIL_LIMIT = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export async function verifyNativeIdToken(options: VerifyIdTokenOptions) {
  const claims = await verifyIdToken({
    ...options,
    requiredClaims: NATIVE_REQUIRED_CLAIMS,
    clockToleranceSeconds: 0,
  });
  if (
    typeof claims.sub !== 'string' ||
    !claims.sub.trim() ||
    claims.sub.length > SUBJECT_LIMIT ||
    typeof claims.iat !== 'number' ||
    !Number.isFinite(claims.iat) ||
    claims.iat > Date.now() / 1000 + ISSUED_AT_TOLERANCE_SECONDS ||
    claims.exp <= claims.iat
  ) {
    throw new Error('Invalid native identity claims');
  }
  return claims;
}

export function nativeProfileFromClaims(
  claims: Awaited<ReturnType<typeof verifyNativeIdToken>>,
  emailVerified = claims.email_verified === true ||
    claims.email_verified === 'true',
): OAuthProfile {
  if (
    typeof claims.email !== 'string' ||
    claims.email.length > EMAIL_LIMIT ||
    !EMAIL_PATTERN.test(claims.email)
  ) {
    throw new Error('Native identity has no email');
  }
  return {
    providerId: claims.sub,
    email: claims.email,
    emailVerified,
    name: nativeDisplayName(claims.name, claims.email),
    ...(typeof claims.picture === 'string'
      ? { avatarUrl: claims.picture }
      : {}),
  };
}
