import type { NativeSignInConfiguration } from '../types/native-application.type';

export function nativePasskeysAvailable(
  signIn: NativeSignInConfiguration | undefined,
): signIn is NativeSignInConfiguration & { rpId: string; origins: string[] } {
  return (
    signIn?.passkeys === true && Boolean(signIn.rpId && signIn.origins?.length)
  );
}
