import type {
  NativePasskeyAssertion,
  NativePasskeyOptions,
  NativeProviderCredential,
  NativeProviderMethod,
} from '@app/sdk';
import type { AbortSignalPort } from './auth';

export type NativePromptResult<T> =
  | { kind: 'success'; value: T }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; reason: 'sdk' | 'invalidResponse' };

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
}
