import type {
  ApiError,
  OAuthError,
  Transport,
  TransportError,
  TransportSignal,
  User,
} from '@app/sdk';
import type {
  BrowserSignInOptions,
  NativeSafeAttemptView,
  NativeSignInAction,
  NativeSignInOutcome,
} from './native-sign-in-actions';
import type { PasskeyPort, ProviderSignInPort } from './passkey-port';
import type { NativeMethods } from '@app/sdk';

export type SessionStatus =
  'restoring' | 'signedOut' | 'signedIn' | 'reauthRequired' | 'storageBlocked';
export type AuthOperation = 'none' | 'authorizing' | 'exchanging' | 'refreshing' | 'signingOut';
export type AuthReason =
  | 'storageFailure'
  | 'storageLocked'
  | 'invalidRecord'
  | 'installMismatch'
  | 'refreshInterrupted'
  | 'oauthFailure'
  | 'disabled'
  | 'profileFailure'
  | 'authorizationDenied'
  | 'deviceKeyUnavailable'
  | 'deviceKeyInvalidated'
  | 'deviceBindingRequired';

export type InvalidCallbackReason =
  | 'tooLong'
  | 'malformed'
  | 'userInfo'
  | 'fragment'
  | 'destinationMismatch'
  | 'repeatedParameter'
  | 'stateMismatch'
  | 'invalidParameters';

export interface AuthConfiguration {
  serverBaseAddress: string;
  environment: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
}

export interface CredentialsPort {
  read(): Promise<CredentialReadResult>;
  replace(value: string): Promise<CredentialWriteResult>;
  delete(): Promise<CredentialWriteResult>;
}

/** A write or delete that did not happen says why, and leaves the stored record as it was. */
export type CredentialWriteResult =
  { kind: 'done' } | { kind: 'locked' } | { kind: 'cancelled' } | { kind: 'unavailable' };

export type CredentialReadResult =
  | { kind: 'found'; value: string }
  | { kind: 'missing' }
  | { kind: 'locked' }
  | { kind: 'cancelled' }
  | { kind: 'corrupt' }
  | { kind: 'unavailable' };

export interface AbortSignalPort extends TransportSignal {
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type AuthBrowserResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'cancelled' }
  | { kind: 'dismissed' }
  | { kind: 'failed'; reason: string };

export interface AuthBrowserPort {
  open(address: string, redirectUri: string, signal: AbortSignalPort): Promise<AuthBrowserResult>;
}

export interface CryptoPort {
  randomBytes(length: number): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
}

export type Unsubscribe = () => void;

export interface CallbackPort {
  subscribe(listener: (address: string) => void | Promise<void>): Unsubscribe;
  initialAddress(): Promise<LaunchAddressResult>;
}

/** `unavailable` means the read failed, so the engine asks again on the next restore. */
export type LaunchAddressResult =
  { kind: 'address'; address: string } | { kind: 'none' } | { kind: 'unavailable' };

export interface ClockPort {
  wallTime(): number;
  monotonicTime(): number;
}

export interface TimerPort {
  after(milliseconds: number, callback: () => void): Unsubscribe;
}

export type InstallIdentityResult =
  { kind: 'found'; id: string } | { kind: 'locked' } | { kind: 'unavailable' };

export interface InstallPort {
  identity(): Promise<InstallIdentityResult>;
}

export interface AuthPorts {
  credentials: CredentialsPort;
  authBrowser: AuthBrowserPort;
  crypto: CryptoPort;
  callbacks: CallbackPort;
  clock: ClockPort;
  timer: TimerPort;
  install: InstallPort;
}

export interface AuthDependencies extends AuthPorts {
  makeTransport(baseAddress: string): Transport<AbortSignalPort>;
  deviceKey?: DeviceKeyPort;
  providerSignIn?: ProviderSignInPort;
  passkeys?: PasskeyPort;
}

export interface AuthSnapshot {
  readonly status: SessionStatus;
  readonly operation: AuthOperation;
  readonly reason?: AuthReason;
  readonly warning?: 'storageBlocked' | undefined;
  readonly profile?: AuthProfile | undefined;
  readonly nativeAttempt?: NativeSafeAttemptView;
}

export type AuthProfile = Omit<Readonly<User>, 'permissions' | 'linkedProviders'> & {
  readonly permissions: readonly string[];
  readonly linkedProviders: readonly string[];
};

export type RestoreOutcome =
  | { kind: 'disposed' }
  | { kind: 'restored'; status: SessionStatus }
  | {
      kind: 'storageBlocked';
      reason:
        'locked' | 'cancelled' | 'unavailable' | 'installUnavailable' | 'deviceKeyUnavailable';
    };

export type SignInOutcome =
  | { kind: 'disposed' }
  | { kind: 'signedIn'; profile: AuthProfile }
  | { kind: 'alreadySignedIn' }
  | { kind: 'signedOut' }
  | { kind: 'cancelled' }
  | { kind: 'dismissed' }
  | { kind: 'expired' }
  | { kind: 'cryptoFailure'; error: Error }
  | { kind: 'clockFailure'; error: Error }
  | { kind: 'browserFailure'; reason: string }
  | { kind: 'authorizationDenied'; error: string }
  | { kind: 'invalidCallback'; reason: InvalidCallbackReason }
  | { kind: 'disabled' }
  | { kind: 'deviceBindingRequired' }
  | {
      kind: 'deviceKeyFailure';
      reason: 'unavailable' | 'cancelled' | 'keyInvalidated' | 'thumbprintMismatch';
    }
  | { kind: 'oauthFailure'; error: OAuthError }
  | { kind: 'throttled'; error: ApiError }
  | { kind: 'transportFailure'; error: TransportError }
  | { kind: 'aborted'; error: TransportError }
  | { kind: 'apiFailure'; error: ApiError }
  | { kind: 'storageFailure'; error: Error };

export type RevocationOutcome =
  'notNeeded' | 'recordUnavailable' | 'revoked' | 'failed' | 'timedOut';

export type SignOutOutcome =
  | { kind: 'disposed'; revocation?: undefined; error?: undefined }
  | {
      kind: 'signedOut';
      revocation: RevocationOutcome;
      error?: Error | ApiError | OAuthError | TransportError | undefined;
    };

/** `error` is what a request waiting on the same refresh would have rejected with. */
export type RefreshOutcome =
  | { kind: 'disposed' }
  | { kind: 'refreshed' }
  | { kind: 'notSignedIn' }
  | { kind: 'failed'; error: Error };

export interface AuthEngine {
  readonly snapshot: AuthSnapshot;
  readonly transport: Transport<AbortSignalPort>;
  subscribe(listener: (snapshot: AuthSnapshot) => void): Unsubscribe;
  restore(): Promise<RestoreOutcome>;
  signIn(options?: BrowserSignInOptions): Promise<SignInOutcome>;
  methods(): Promise<NativeMethods>;
  nativeSignIn(action: NativeSignInAction): Promise<NativeSignInOutcome>;
  cancelNativeSignIn(): Promise<NativeSignInOutcome>;
  signOut(): Promise<SignOutOutcome>;
  /** Refreshes now, sharing any refresh already running. */
  refresh(): Promise<RefreshOutcome>;
  dispose(): void;
}

export type DeviceKeyFailure =
  { kind: 'unavailable' } | { kind: 'cancelled' } | { kind: 'keyInvalidated' };

export interface Es256PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  alg: 'ES256';
}

export type DeviceKeyResult<T> = { kind: 'success'; value: T } | DeviceKeyFailure;

/** The shell keeps this ES256 private key in device secure hardware. */
export interface DeviceKeyPort {
  publicKey(): Promise<DeviceKeyResult<Es256PublicJwk>>;
  sign(data: Uint8Array): Promise<DeviceKeyResult<Uint8Array>>;
}
