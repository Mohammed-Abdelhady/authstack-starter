import { isDeepStrictEqual } from 'node:util';
import { SIGN_UP_POLICY } from '../../config/constants/host-contracts';
import type { NativeApplicationConfiguration } from '../../config/types/native-application.type';
import type { StoredRegistration } from './application-registry.store';
import type { ApplicationSignInMethods } from './types/application-sign-in-methods';

export function nativePolicySnapshot(
  application: NativeApplicationConfiguration,
): ApplicationSignInMethods | null {
  if (!application.signIn && !application.firstParty) return null;
  return {
    ...application.signIn,
    ...(application.firstParty ? { firstParty: true } : {}),
  };
}

export function nativePolicyChanged(
  stored: StoredRegistration | undefined,
  application: NativeApplicationConfiguration,
): boolean {
  if (!stored) return false;
  return (
    (stored.signUp ?? SIGN_UP_POLICY.OPEN) !==
      (application.signUp ?? SIGN_UP_POLICY.OPEN) ||
    (stored.requirePasskey ?? false) !==
      (application.requirePasskey ?? false) ||
    stored.accountAudience !== application.audience ||
    (stored.allowedScopes !== undefined &&
      !isDeepStrictEqual(
        [...stored.allowedScopes].sort(),
        [...application.allowedScopes].sort(),
      )) ||
    !isDeepStrictEqual(
      stored.signInMethods ?? null,
      nativePolicySnapshot(application),
    )
  );
}
