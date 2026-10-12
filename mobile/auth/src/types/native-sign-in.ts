import type {
  NativeActivationInput,
  NativeAttemptView,
  NativeFlow,
  NativeMethods,
  NativePasskeyAssertion,
  NativePasskeyOptions,
  NativeProviderCredential,
  NativeProviderMethod,
  NativeRecoveryConfirmationInput,
  NativeSecondFactorInput,
} from '@app/sdk';
import type { AbortSignalPort, AuthProfile } from './auth';

type ReadonlyNativeView<V> = V extends { factors: infer F extends unknown[] }
  ? Omit<V, 'factors'> & { readonly factors: Readonly<F> }
  : V extends { application: infer A extends { scopes: string[] } }
    ? Omit<V, 'application'> & {
        readonly application: Omit<A, 'scopes'> & { readonly scopes: readonly string[] };
      }
    : V;

export type NativeSafeAttemptView = ReadonlyNativeView<
  Exclude<NativeAttemptView, { stage: 'codeReady' }>
>;

export interface BrowserSignInOptions {
  providerId?: string;
  flow?: NativeFlow;
  locale?: 'en' | 'ar';
}

export type NativeSignInAction =
  | { kind: 'start'; flow: NativeFlow }
  | { kind: 'password'; email: string; password: string }
  | { kind: 'provider'; providerId: string; locale?: BrowserSignInOptions['locale'] }
  | { kind: 'passkey' }
  | { kind: 'secondFactor'; input: NativeSecondFactorInput }
  | { kind: 'requestEmailLink'; email: string }
  | { kind: 'verifyEmailLink'; token: string; state: string }
  | { kind: 'register'; email: string }
  | { kind: 'activate'; input: NativeActivationInput }
  | { kind: 'requestRecovery'; email: string }
  | { kind: 'confirmRecovery'; input: NativeRecoveryConfirmationInput }
  | { kind: 'consent' };

export type NativeSignInOutcome =
  | { kind: 'continue'; view: NativeSafeAttemptView }
  | { kind: 'signedIn'; profile: AuthProfile }
  | { kind: 'activationCompleted'; view?: NativeSafeAttemptView }
  | { kind: 'recoveryComplete' }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'busy' }
  | { kind: 'invalidInput' }
  | { kind: 'storageFailure' }
  | { kind: 'apiFailure' }
  | { kind: 'transportFailure' }
  | { kind: 'disabled' }
  | { kind: 'disposed' }
  | { kind: 'signedOut' };

export type NativePromptResult<T> =
  | { kind: 'success'; value: T }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; reason: 'sdk' | 'invalidResponse' };

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

export interface NativeController {
  needsCancellation(): boolean;
  methods(): Promise<NativeMethods>;
  nativeSignIn(action: NativeSignInAction): Promise<NativeSignInOutcome>;
  cancelNativeSignIn(): Promise<NativeSignInOutcome>;
  handleAddress(address: string): Promise<boolean>;
  processInitialAddress(address?: string): Promise<void>;
  restore(epoch: number): Promise<void>;
}

export type { NativeMethods };
