import type {
  AuthPortFailureReason,
  AuthSnapshot,
  CredentialStoreCondition,
  DeviceKeyErrorReason,
  RefreshOutcome,
  RestoreOutcome,
  SignInOutcome,
  SignOutOutcome,
} from '@app/native-auth';
import type { TransportError } from '@app/sdk';
import type { MessageKey } from '../i18n/messages';

export const DEBUG_ACTION = {
  RESTORE: 'restore',
  SIGN_IN: 'signIn',
  REFRESH: 'refresh',
  PROFILE: 'profile',
  SIGN_OUT: 'signOut',
} as const;
export type DebugAction = (typeof DEBUG_ACTION)[keyof typeof DEBUG_ACTION];

export const STORAGE_WARNING = {
  SESSION_IN_MEMORY: 'sessionInMemory',
  DELETE_FAILED: 'deleteFailed',
  REFRESH_NOT_SENT: 'refreshNotSent',
} as const;
export type StorageWarning = (typeof STORAGE_WARNING)[keyof typeof STORAGE_WARNING];

type RestoreBlock = Extract<RestoreOutcome, { kind: 'storageBlocked' }>['reason'];
type CallbackReason = Extract<SignInOutcome, { kind: 'invalidCallback' }>['reason'];
type Revocation = Extract<SignOutOutcome, { kind: 'signedOut' }>['revocation'];

export const ACTION_KEY: Record<DebugAction, MessageKey> = {
  restore: 'actionRestore',
  signIn: 'actionSignIn',
  refresh: 'actionRefresh',
  profile: 'actionProfile',
  signOut: 'actionSignOut',
};

export const STATUS_KEY: Record<AuthSnapshot['status'], MessageKey> = {
  restoring: 'statusRestoring',
  signedOut: 'statusSignedOut',
  signedIn: 'statusSignedIn',
  reauthRequired: 'statusReauthRequired',
  storageBlocked: 'statusStorageBlocked',
};

export const OPERATION_KEY: Record<AuthSnapshot['operation'], MessageKey> = {
  none: 'none',
  authorizing: 'operationAuthorizing',
  exchanging: 'operationExchanging',
  refreshing: 'operationRefreshing',
  signingOut: 'operationSigningOut',
};

export const REASON_KEY: Record<NonNullable<AuthSnapshot['reason']>, MessageKey> = {
  storageFailure: 'reasonStorageFailure',
  storageLocked: 'reasonStorageLocked',
  invalidRecord: 'reasonInvalidRecord',
  installMismatch: 'reasonInstallMismatch',
  refreshInterrupted: 'reasonRefreshInterrupted',
  oauthFailure: 'reasonOauthFailure',
  disabled: 'reasonDisabled',
  profileFailure: 'reasonProfileFailure',
  authorizationDenied: 'reasonAuthorizationDenied',
  deviceKeyUnavailable: 'reasonDeviceKeyUnavailable',
  deviceKeyInvalidated: 'reasonDeviceKeyInvalidated',
  deviceBindingRequired: 'reasonDeviceBindingRequired',
};

export const STORAGE_WARNING_KEY: Record<StorageWarning, MessageKey> = {
  sessionInMemory: 'warningSessionInMemory',
  deleteFailed: 'warningDeleteFailed',
  refreshNotSent: 'warningRefreshNotSent',
};

/** One catalogue key for every outcome kind of every engine action. */
export const OUTCOME_KEY: {
  restore: Record<RestoreOutcome['kind'], MessageKey>;
  signIn: Record<SignInOutcome['kind'], MessageKey>;
  refresh: Record<RefreshOutcome['kind'], MessageKey>;
  signOut: Record<SignOutOutcome['kind'], MessageKey>;
} = {
  restore: {
    disposed: 'engineDisposed',
    restored: 'restoreRestored',
    storageBlocked: 'restoreStorageBlocked',
  },
  signIn: {
    disposed: 'engineDisposed',
    signedIn: 'statusSignedIn',
    alreadySignedIn: 'signInAlreadySignedIn',
    signedOut: 'signInSignedOut',
    cancelled: 'signInCancelled',
    dismissed: 'signInDismissed',
    expired: 'signInExpired',
    cryptoFailure: 'signInCryptoFailure',
    clockFailure: 'signInClockFailure',
    browserFailure: 'signInBrowserFailure',
    authorizationDenied: 'signInAuthorizationDenied',
    invalidCallback: 'signInInvalidCallback',
    disabled: 'reasonDisabled',
    deviceBindingRequired: 'reasonDeviceBindingRequired',
    deviceKeyFailure: 'signInDeviceKeyFailure',
    oauthFailure: 'signInOauthFailure',
    throttled: 'signInThrottled',
    transportFailure: 'signInTransportFailure',
    aborted: 'signInAborted',
    apiFailure: 'signInApiFailure',
    storageFailure: 'signInStorageFailure',
  },
  refresh: {
    disposed: 'engineDisposed',
    refreshed: 'refreshRefreshed',
    notSignedIn: 'refreshNotSignedIn',
    failed: 'refreshFailed',
  },
  signOut: {
    disposed: 'engineDisposed',
    signedOut: 'signOutSignedOut',
    signOutNotSaved: 'reasonStorageFailure',
  },
};

export const RESTORE_BLOCK_KEY: Record<RestoreBlock, MessageKey> = {
  locked: 'blockLocked',
  cancelled: 'blockCancelled',
  unavailable: 'blockUnavailable',
  installUnavailable: 'blockInstallUnavailable',
  deviceKeyUnavailable: 'reasonDeviceKeyUnavailable',
};

export const CALLBACK_REASON_KEY: Record<CallbackReason, MessageKey> = {
  tooLong: 'callbackTooLong',
  malformed: 'callbackMalformed',
  userInfo: 'callbackUserInfo',
  fragment: 'callbackFragment',
  destinationMismatch: 'callbackDestinationMismatch',
  repeatedParameter: 'callbackRepeatedParameter',
  stateMismatch: 'callbackStateMismatch',
  invalidParameters: 'callbackInvalidParameters',
};

export const DEVICE_KEY_REASON_KEY: Record<DeviceKeyErrorReason, MessageKey> = {
  unavailable: 'reasonDeviceKeyUnavailable',
  cancelled: 'keyCancelled',
  keyInvalidated: 'reasonDeviceKeyInvalidated',
  thumbprintMismatch: 'keyThumbprintMismatch',
};

export const REVOCATION_KEY: Record<Revocation, MessageKey> = {
  notNeeded: 'revocationNotNeeded',
  recordUnavailable: 'revocationRecordUnavailable',
  revoked: 'revocationRevoked',
  failed: 'revocationFailed',
  timedOut: 'revocationTimedOut',
};

export const STORE_CONDITION_KEY: Record<CredentialStoreCondition, MessageKey> = {
  locked: 'blockLocked',
  cancelled: 'blockCancelled',
  unavailable: 'blockUnavailable',
};

export const TRANSPORT_REASON_KEY: Record<TransportError['reason'], MessageKey> = {
  aborted: 'errorAborted',
  no_response: 'errorNoResponse',
};

export const PORT_FAILURE_KEY: Record<AuthPortFailureReason, MessageKey> = {
  timedOut: 'errorPortTimedOut',
  failed: 'errorPortFailed',
};

/** The codes the browser adapter reports on its own. Another code reads as `browserOther`. */
export const BROWSER_REASON_KEY: Readonly<Record<string, MessageKey>> = {
  redirectWithoutAddress: 'browserRedirectWithoutAddress',
  browserLocked: 'browserLocked',
  unexpectedResult: 'browserUnexpectedResult',
  unknown: 'browserUnknown',
};

/** The engine names a port call by these strings in its errors. Another name reads as `portOther`. */
export const PORT_OPERATION_KEY: Readonly<Record<string, MessageKey>> = {
  'credentials.read': 'portCredentialsRead',
  'credentials.replace': 'portCredentialsReplace',
  'credentials.delete': 'portCredentialsDelete',
  'install.identity': 'portInstallIdentity',
  'crypto.randomBytes': 'portRandomBytes',
  'crypto.sha256': 'portSha256',
  'callbacks.initialAddress': 'portInitialAddress',
  'deviceKey.publicKey': 'portDeviceKeyPublicKey',
  'deviceKey.sign': 'portDeviceKeySign',
};
