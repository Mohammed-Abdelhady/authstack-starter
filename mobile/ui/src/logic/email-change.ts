import { ErrorCode } from '@app/core';
import { API_FAILURE } from '../constants';
import { EMAIL_OUTCOME, type EmailOutcome } from '../constants/email-change';
import type { MessageKey, Translate } from '../i18n';
import type { ApiFailure } from '../types';
import { isolateLtr } from './isolate';

/** What a refused request means for the person, by the code the server sent. */
const REFUSAL_OUTCOME = new Map<string, EmailOutcome>([
  [ErrorCode.REAUTH_REQUIRED, EMAIL_OUTCOME.SIGN_IN_AGAIN],
  [ErrorCode.VALIDATION_ERROR, EMAIL_OUTCOME.INVALID_ADDRESS],
  [ErrorCode.EMAIL_SEND_LIMIT_REACHED, EMAIL_OUTCOME.LIMIT_REACHED],
  [ErrorCode.ACTIVATION_CODE_INVALID, EMAIL_OUTCOME.CODE_REFUSED],
]);

export function outcomeOfFailure(failure: ApiFailure): EmailOutcome {
  if (failure.kind === API_FAILURE.OFFLINE) return EMAIL_OUTCOME.OFFLINE;
  if (failure.kind !== API_FAILURE.REFUSED || failure.code === undefined) {
    return EMAIL_OUTCOME.FAILED;
  }
  return REFUSAL_OUTCOME.get(failure.code) ?? EMAIL_OUTCOME.FAILED;
}

export interface EmailNotice {
  title: string;
  description?: string;
  problem: boolean;
}

const NOTICE_TEXT: Record<
  EmailOutcome,
  { title: MessageKey; description?: MessageKey; problem: boolean }
> = {
  sent: {
    title: 'email.outcome.sent.title',
    description: 'email.outcome.sent.description',
    problem: false,
  },
  changed: {
    title: 'email.outcome.changed.title',
    description: 'email.outcome.changed.description',
    problem: false,
  },
  cancelled: { title: 'email.outcome.cancelled.title', problem: false },
  signInAgain: {
    title: 'email.outcome.signInAgain.title',
    description: 'email.outcome.signInAgain.description',
    problem: true,
  },
  invalidAddress: {
    title: 'email.outcome.invalidAddress.title',
    description: 'email.outcome.invalidAddress.description',
    problem: true,
  },
  limitReached: {
    title: 'email.outcome.limitReached.title',
    description: 'email.outcome.limitReached.description',
    problem: true,
  },
  codeRefused: {
    title: 'email.outcome.codeRefused.title',
    description: 'email.outcome.codeRefused.description',
    problem: true,
  },
  offline: { title: 'email.outcome.failed.title', description: 'common.offline', problem: true },
  failed: {
    title: 'email.outcome.failed.title',
    description: 'common.serverError',
    problem: true,
  },
};

/** The notice for an outcome. An address always reads left to right. */
export function emailNotice(t: Translate, outcome: EmailOutcome, address = ''): EmailNotice {
  const text = NOTICE_TEXT[outcome];
  const values = { address: isolateLtr(address) };
  return {
    title: t(text.title, values),
    ...(text.description === undefined ? {} : { description: t(text.description, values) }),
    problem: text.problem,
  };
}
