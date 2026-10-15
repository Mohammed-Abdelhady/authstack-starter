import {
  AuthDisposedError,
  AuthPortError,
  AuthSessionError,
  CredentialStoreError,
  DeviceBindingRequiredError,
  DeviceKeyAuthError,
  UnsafeRequestPathError,
  type RefreshOutcome,
  type RestoreOutcome,
  type SignInOutcome,
  type SignOutOutcome,
} from '@app/native-auth';
import { isolateLtr } from '@app/native-ui/host';
import { ApiError, OAuthError, TransportError } from '@app/sdk';
import { translate, type Locale, type MessageKey } from '../i18n/messages';
import {
  ACTION_KEY,
  BROWSER_REASON_KEY,
  CALLBACK_REASON_KEY,
  DEVICE_KEY_REASON_KEY,
  OUTCOME_KEY,
  PORT_FAILURE_KEY,
  PORT_OPERATION_KEY,
  RESTORE_BLOCK_KEY,
  REVOCATION_KEY,
  STATUS_KEY,
  STORE_CONDITION_KEY,
  TRANSPORT_REASON_KEY,
  type DebugAction,
} from './outcome-keys';

/** A catalogue message. A string part is data from outside: an address, a server code, a type name. */
export interface Described {
  key: MessageKey;
  value?: Described | string;
  detail?: Described | string;
}

const BROWSER_REASON_SEPARATOR = ':';

function renderPart(locale: Locale, part: Described | string | undefined): string | undefined {
  if (part === undefined) return undefined;
  // Data from outside keeps its own order inside a sentence of either direction.
  return typeof part === 'string' ? isolateLtr(part) : render(locale, part);
}

export function render(locale: Locale, described: Described): string {
  return translate(
    locale,
    described.key,
    renderPart(locale, described.value),
    renderPart(locale, described.detail),
  );
}

function describePort(operation: string): Described {
  const key = Object.hasOwn(PORT_OPERATION_KEY, operation)
    ? PORT_OPERATION_KEY[operation]
    : undefined;
  return { key: key ?? 'portOther' };
}

export function describeError(error: unknown): Described {
  if (error instanceof ApiError) return { key: 'errorApi', value: `${error.status} ${error.code}` };
  if (error instanceof OAuthError) {
    return { key: 'errorOAuth', value: `${error.status} ${error.error}` };
  }
  if (error instanceof TransportError) return { key: TRANSPORT_REASON_KEY[error.reason] };
  if (error instanceof CredentialStoreError) {
    return {
      key: 'errorStore',
      value: describePort(error.operation),
      detail: { key: STORE_CONDITION_KEY[error.condition] },
    };
  }
  if (error instanceof AuthPortError) {
    return { key: PORT_FAILURE_KEY[error.reason], value: describePort(error.operation) };
  }
  if (error instanceof DeviceKeyAuthError) {
    return { key: 'signInDeviceKeyFailure', value: { key: DEVICE_KEY_REASON_KEY[error.reason] } };
  }
  if (error instanceof DeviceBindingRequiredError) return { key: 'reasonDeviceBindingRequired' };
  if (error instanceof AuthSessionError) return { key: 'errorSession' };
  if (error instanceof AuthDisposedError) return { key: 'engineDisposed' };
  if (error instanceof UnsafeRequestPathError) return { key: 'errorUnsafePath' };
  if (error instanceof Error) return { key: 'errorUnexpected', value: error.name };
  return { key: 'errorUnknown' };
}

/** The adapter reports its own codes, or the platform's code or text for anything else. */
function describeBrowserReason(reason: string): Described {
  const [code = ''] = reason.split(BROWSER_REASON_SEPARATOR);
  const key = Object.hasOwn(BROWSER_REASON_KEY, code) ? BROWSER_REASON_KEY[code] : undefined;
  return key === undefined ? { key: 'browserOther', value: reason } : { key };
}

export function describeRestore(outcome: RestoreOutcome): Described {
  const key = OUTCOME_KEY.restore[outcome.kind];
  if (outcome.kind === 'restored') return { key, value: { key: STATUS_KEY[outcome.status] } };
  if (outcome.kind === 'storageBlocked') {
    return { key, value: { key: RESTORE_BLOCK_KEY[outcome.reason] } };
  }
  return { key };
}

export function describeSignIn(outcome: SignInOutcome): Described {
  const key = OUTCOME_KEY.signIn[outcome.kind];
  switch (outcome.kind) {
    case 'browserFailure':
      return { key, value: describeBrowserReason(outcome.reason) };
    case 'authorizationDenied':
      return { key, value: outcome.error };
    case 'invalidCallback':
      return { key, value: { key: CALLBACK_REASON_KEY[outcome.reason] } };
    case 'deviceKeyFailure':
      return { key, value: { key: DEVICE_KEY_REASON_KEY[outcome.reason] } };
    case 'cryptoFailure':
    case 'clockFailure':
    case 'oauthFailure':
    case 'throttled':
    case 'transportFailure':
    case 'aborted':
    case 'apiFailure':
    case 'storageFailure':
      return { key, value: describeError(outcome.error) };
    default:
      return { key };
  }
}

export function describeRefresh(outcome: RefreshOutcome): Described {
  const key = OUTCOME_KEY.refresh[outcome.kind];
  return outcome.kind === 'failed' ? { key, value: describeError(outcome.error) } : { key };
}

export function describeSignOut(outcome: SignOutOutcome): Described {
  if (outcome.kind === 'disposed') return { key: OUTCOME_KEY.signOut.disposed };
  if (outcome.kind === 'signOutNotSaved') return { key: OUTCOME_KEY.signOut.signOutNotSaved };
  const value: Described = { key: REVOCATION_KEY[outcome.revocation] };
  return outcome.error === undefined
    ? { key: OUTCOME_KEY.signOut.signedOut, value }
    : { key: 'signOutSignedOutWithError', value, detail: describeError(outcome.error) };
}

export function describeProfile(email: string): Described {
  return { key: 'profileLoaded', value: email };
}

export function describeAction(action: DebugAction, result: Described): Described {
  return { key: ACTION_KEY[action], value: result };
}
