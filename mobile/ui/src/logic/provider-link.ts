import { NATIVE_PROVIDER_SDK_MODE } from '@app/core';
import type { NativeProviderMethod } from '@app/sdk';

/**
 * Whether the app's prompt for a method makes a proof that carries a link's
 * nonce, which the server needs to link it. A system prompt makes none.
 * Facebook makes one only through limited login, which the app uses on iOS;
 * on Android it gets an access token that carries no nonce.
 */
export function linksInApp(method: NativeProviderMethod, platform: string): boolean {
  if (method.mode === NATIVE_PROVIDER_SDK_MODE.SYSTEM) return false;
  return method.mode !== NATIVE_PROVIDER_SDK_MODE.FACEBOOK || platform === 'ios';
}
