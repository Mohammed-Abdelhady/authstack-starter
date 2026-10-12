import type { PasskeyPort, ProviderSignInPort } from '@app/native-auth';
import type { NativeSignInModules, NativeSignInSettings } from './types/sign-in-modules';
import { createNativePromptLease } from './logic/prompt-lease';
import { createPasskeySignInPort } from './ports/passkey-sign-in';
import { createProviderSignInPort } from './ports/provider-sign-in';

export interface NativeSignInDependencies {
  providerSignIn: ProviderSignInPort;
  passkeys: PasskeyPort;
}

/** Builds both native prompt ports over one cross-provider/passkey sheet lease. */
export function createNativeSignInPorts(
  modules: NativeSignInModules,
  settings: NativeSignInSettings,
): NativeSignInDependencies {
  const lease = createNativePromptLease();
  return {
    providerSignIn: createProviderSignInPort(modules, settings, lease),
    passkeys: createPasskeySignInPort(modules.platform, modules.passkeys, settings, lease),
  };
}
