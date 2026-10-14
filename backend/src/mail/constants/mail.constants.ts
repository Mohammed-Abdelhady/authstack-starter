import { EMAIL_CHANGE_CODE_EN } from '../catalog/en/email-change-code';
import { EMAIL_CHANGE_NOTICE_EN } from '../catalog/en/email-change-notice';
import { PASSWORD_RESET_CODE_EN } from '../catalog/en/password-reset-code';
import { REGISTRATION_NOTICE_EN } from '../catalog/en/registration-notice';

export { EMAIL_CHANGE_CONFIRM_PATH } from './mail-names';

/** How long shutdown waits for in-flight mail before it gives up. */
export const MAIL_DRAIN_DEADLINE_MS = 5000;

/**
 * Most deferred sends the dispatcher will hold at once. Above this a send is
 * dropped with a log line, because every pending send holds an SMTP
 * connection and a caller that has already been answered can leave one behind.
 */
export const MAIL_MAX_PENDING_SENDS = 100;

/**
 * SMTP pool settings. nodemailer's SMTP transport supports a connection pool,
 * so the deferred sends share connections instead of opening one each.
 */
export const MAIL_POOL_MAX_CONNECTIONS = 5;
export const MAIL_POOL_MAX_MESSAGES = 100;

/**
 * Per-send SMTP deadlines. Without them nodemailer's defaults let a stalling
 * server hold every pool connection for ten minutes, fill the pending set and
 * drop later mail. Each phase gets its own bound.
 */
export const MAIL_CONNECTION_TIMEOUT_MS = 10000;
export const MAIL_GREETING_TIMEOUT_MS = 10000;
export const MAIL_SOCKET_TIMEOUT_MS = 20000;

/** English subjects, for the API suites that pick a mail out by its subject. */
export const EMAIL_CHANGE_EMAIL_SUBJECT = EMAIL_CHANGE_CODE_EN.subject;
export const EMAIL_CHANGE_NOTICE_SUBJECT = EMAIL_CHANGE_NOTICE_EN.subject;
export const PASSWORD_RESET_EMAIL_SUBJECT = PASSWORD_RESET_CODE_EN.subject;
export const REGISTRATION_NOTICE_EMAIL_SUBJECT = REGISTRATION_NOTICE_EN.subject;

/** Prefix of the shutdown log line, shared with the specs. */
export const MAIL_DRAIN_DEADLINE_LOG = 'Mail drain deadline reached';

export const MS_PER_MINUTE = 60 * 1000;
