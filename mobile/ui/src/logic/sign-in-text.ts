import { SIGN_IN_STATE, type SignInFailure, type SignInState } from '../constants';
import type { MessageKey } from '../i18n';
import type { NoticeText, SignInView } from '../types';

const FAILURE_TEXT: Record<SignInFailure, MessageKey> = {
  expired: 'signIn.failed.expired',
  denied: 'signIn.failed.denied',
  disabled: 'signIn.failed.disabled',
  throttled: 'signIn.failed.throttled',
  sessionLimit: 'signIn.failed.sessionLimit',
  deviceKey: 'signIn.failed.deviceKey',
  browser: 'signIn.failed.browser',
  storage: 'signIn.failed.storage',
  generic: 'signIn.failed.generic',
};

const STATE_NOTICE: Record<SignInState, NoticeText | undefined> = {
  restoring: undefined,
  idle: undefined,
  inProgress: {
    title: 'signIn.inProgress.title',
    description: 'signIn.inProgress.description',
  },
  browserClosed: {
    title: 'signIn.browserClosed.title',
    description: 'signIn.browserClosed.description',
  },
  offline: { title: 'signIn.offline.title', description: 'common.offline' },
  storageLocked: {
    title: 'signIn.storageLocked.title',
    description: 'signIn.storageLocked.description',
  },
  failed: { title: 'signIn.failed.title', description: 'signIn.failed.generic' },
};

const ACTION_TEXT: Record<SignInState, MessageKey> = {
  restoring: 'signIn.restoring',
  idle: 'signIn.action',
  inProgress: 'signIn.waiting',
  browserClosed: 'signIn.action',
  offline: 'common.tryAgain',
  storageLocked: 'common.tryAgain',
  failed: 'common.tryAgain',
};

/** States that report something went wrong, as opposed to something still under way. */
const PROBLEM_STATES: readonly SignInState[] = [
  SIGN_IN_STATE.OFFLINE,
  SIGN_IN_STATE.STORAGE_LOCKED,
  SIGN_IN_STATE.FAILED,
];

export function signInNotice(view: SignInView): NoticeText | undefined {
  if (view.sessionEnded) {
    return { title: 'signIn.reauth.title', description: 'signIn.reauth.description' };
  }
  const notice = STATE_NOTICE[view.state];
  if (notice === undefined || view.failure === undefined) return notice;
  return { ...notice, description: FAILURE_TEXT[view.failure] };
}

export function signInActionText(view: SignInView): MessageKey {
  return ACTION_TEXT[view.state];
}

export function isProblem(view: SignInView): boolean {
  return PROBLEM_STATES.includes(view.state);
}
