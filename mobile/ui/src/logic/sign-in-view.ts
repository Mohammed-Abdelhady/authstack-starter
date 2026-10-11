import { CredentialStoreError, type AuthReason, type SignInOutcome } from '@app/native-auth';
import { OAUTH_ERROR } from '@app/sdk';
import {
  ROOT_VIEW,
  SIGN_IN_ACTION,
  SIGN_IN_FAILURE,
  SIGN_IN_STATE,
  type RootView,
  type SignInFailure,
  type SignInState,
} from '../constants';
import type { SignInAttempt, SignInView, SnapshotInput } from '../types';

type OutcomeKind = SignInOutcome['kind'];
type Shown = { state: SignInState; failure?: SignInFailure };

const failed = (failure: SignInFailure): Shown => ({ state: SIGN_IN_STATE.FAILED, failure });

/** Every engine outcome is listed, so a new one fails to compile until it is given a screen state. */
const OUTCOME_VIEW: Record<OutcomeKind, Shown | undefined> = {
  signedIn: undefined,
  alreadySignedIn: undefined,
  signedOut: undefined,
  disposed: undefined,
  cancelled: { state: SIGN_IN_STATE.BROWSER_CLOSED },
  dismissed: { state: SIGN_IN_STATE.BROWSER_CLOSED },
  transportFailure: { state: SIGN_IN_STATE.OFFLINE },
  expired: failed(SIGN_IN_FAILURE.EXPIRED),
  authorizationDenied: failed(SIGN_IN_FAILURE.DENIED),
  disabled: failed(SIGN_IN_FAILURE.DISABLED),
  throttled: failed(SIGN_IN_FAILURE.THROTTLED),
  deviceBindingRequired: failed(SIGN_IN_FAILURE.DEVICE_KEY),
  deviceKeyFailure: failed(SIGN_IN_FAILURE.DEVICE_KEY),
  browserFailure: failed(SIGN_IN_FAILURE.BROWSER),
  storageFailure: failed(SIGN_IN_FAILURE.STORAGE),
  invalidCallback: failed(SIGN_IN_FAILURE.GENERIC),
  cryptoFailure: failed(SIGN_IN_FAILURE.GENERIC),
  clockFailure: failed(SIGN_IN_FAILURE.GENERIC),
  oauthFailure: failed(SIGN_IN_FAILURE.GENERIC),
  apiFailure: failed(SIGN_IN_FAILURE.GENERIC),
  aborted: failed(SIGN_IN_FAILURE.GENERIC),
};

const BLOCKED_VIEW: Record<NonNullable<SignInAttempt['blocked']>, Shown> = {
  locked: { state: SIGN_IN_STATE.STORAGE_LOCKED },
  cancelled: failed(SIGN_IN_FAILURE.STORAGE),
  unavailable: failed(SIGN_IN_FAILURE.STORAGE),
  installUnavailable: failed(SIGN_IN_FAILURE.STORAGE),
  deviceKeyUnavailable: failed(SIGN_IN_FAILURE.DEVICE_KEY),
};
const RESTORE_REASON_VIEW: Partial<Record<AuthReason, Shown>> = {
  storageFailure: failed(SIGN_IN_FAILURE.STORAGE),
  deviceKeyUnavailable: failed(SIGN_IN_FAILURE.DEVICE_KEY),
};

const BROWSER_OPERATIONS: readonly string[] = ['authorizing', 'exchanging'];

function storeIsLocked(outcome: SignInOutcome): boolean {
  return (
    outcome.kind === 'storageFailure' &&
    outcome.error instanceof CredentialStoreError &&
    outcome.error.condition === 'locked'
  );
}

/** The token route answers `access_denied` only when the account holds its limit of sessions. */
function sessionLimitReached(outcome: SignInOutcome): boolean {
  return outcome.kind === 'oauthFailure' && outcome.error.error === OAUTH_ERROR.ACCESS_DENIED;
}

function outcomeView(outcome: SignInOutcome | undefined): Shown | undefined {
  if (outcome === undefined) return undefined;
  if (storeIsLocked(outcome)) return { state: SIGN_IN_STATE.STORAGE_LOCKED };
  if (sessionLimitReached(outcome)) return failed(SIGN_IN_FAILURE.SESSION_LIMIT);
  return OUTCOME_VIEW[outcome.kind];
}

/** The one screen state for what the engine reports and how the last attempt ended. */
export function signInView(snapshot: SnapshotInput, attempt: SignInAttempt): SignInView {
  const base = { action: SIGN_IN_ACTION.SIGN_IN, canAct: true, sessionEnded: false };
  if (
    snapshot.status === 'restoring' ||
    (attempt.pending && attempt.action === SIGN_IN_ACTION.RESTORE)
  ) {
    return { ...base, state: SIGN_IN_STATE.RESTORING, canAct: false };
  }
  if (attempt.pending || BROWSER_OPERATIONS.includes(snapshot.operation)) {
    return { ...base, state: SIGN_IN_STATE.IN_PROGRESS, canAct: false };
  }
  if (snapshot.status === 'storageBlocked') {
    const shown =
      attempt.blocked !== undefined
        ? BLOCKED_VIEW[attempt.blocked]
        : snapshot.reason !== undefined
          ? RESTORE_REASON_VIEW[snapshot.reason]
          : undefined;
    return {
      ...base,
      ...(shown ?? { state: SIGN_IN_STATE.STORAGE_LOCKED }),
      action: SIGN_IN_ACTION.RESTORE,
    };
  }
  if (attempt.failure !== undefined) return { ...base, ...failed(attempt.failure) };
  const shown = outcomeView(attempt.outcome);
  if (shown !== undefined) return { ...base, ...shown };
  return { ...base, state: SIGN_IN_STATE.IDLE, sessionEnded: snapshot.status === 'reauthRequired' };
}

/** A session that is being signed out no longer shows the signed-in screens. */
export function rootView(snapshot: SnapshotInput): RootView {
  const live = snapshot.status === 'signedIn' && snapshot.operation !== 'signingOut';
  return live ? ROOT_VIEW.SIGNED_IN : ROOT_VIEW.SIGN_IN;
}
