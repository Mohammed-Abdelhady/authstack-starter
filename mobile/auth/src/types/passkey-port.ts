import type {
  NativePasskeyAssertion,
  NativePasskeyOptions,
  PasskeyAttestation,
  PasskeyCreationOptions,
  NativeProviderCredential,
  NativeProviderMethod,
} from '@app/sdk';
import type { AbortSignalPort } from './auth';

export type NativePromptResult<T> =
  | { kind: 'success'; value: T }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; reason: 'sdk' | 'invalidResponse' };

/**
 * A registration prompt also ends with `excluded`: the authenticator already
 * holds a passkey the options listed to leave out.
 */
export type NativeRegistrationResult<T> = NativePromptResult<T> | { kind: 'excluded' };

export interface NativeInteractivePromptRequest<T> {
  controller: { signal: AbortSignalPort; abort(): void };
  expiresAt: number;
  start: () => Promise<NativePromptResult<T>>;
}

export type NativeInteractivePrompt = <T>(
  request: NativeInteractivePromptRequest<T>,
) => Promise<NativePromptResult<T> | { kind: 'expired' }>;

export interface ProviderSignInPort {
  available(method: NativeProviderMethod): Promise<boolean>;
  authenticate(
    request: { method: NativeProviderMethod; nonceDigest: string; state: string },
    signal: AbortSignalPort,
  ): Promise<NativePromptResult<NativeProviderCredential>>;
}

export interface PasskeyPort {
  available(): Promise<boolean>;
  authenticate(
    options: NativePasskeyOptions,
    signal: AbortSignalPort,
  ): Promise<NativePromptResult<NativePasskeyAssertion>>;
  /** Makes a passkey. A port without it reads as a device that cannot make one. */
  register?(
    options: PasskeyCreationOptions,
    signal: AbortSignalPort,
  ): Promise<NativeRegistrationResult<PasskeyAttestation>>;
}
