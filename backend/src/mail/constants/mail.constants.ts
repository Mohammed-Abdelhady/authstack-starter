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

/** Client page the admin email-change mail points at. */
export const EMAIL_CHANGE_CONFIRM_PATH = '/auth/confirm-email-change';

/** Subjects, shared by the mailer and the specs that assert on them. */
export const ACTIVATION_EMAIL_SUBJECT = 'Verify Your Email Address';
export const EMAIL_CHANGE_EMAIL_SUBJECT = 'Confirm your new email address';
export const EMAIL_CHANGE_NOTICE_SUBJECT =
  'A pending email change was requested';
export const PASSWORD_RESET_EMAIL_SUBJECT = 'Reset Your Password';
export const MAGIC_LINK_EMAIL_SUBJECT = 'Your Sign-In Link';
export const REGISTRATION_NOTICE_EMAIL_SUBJECT =
  'Someone tried to register with your email address';

/** The neutral greeting used before a name is known, shared with the specs. */
export const NEUTRAL_GREETING = 'Hi,';

/** Sign-up body sentence, shared with the specs instead of copied. */
export const ACTIVATION_BODY_TEXT =
  'Please use the following 6-digit verification code to complete your registration:';

/** Email-change body sentence, shared with the specs instead of copied. */
export const EMAIL_CHANGE_BODY_TEXT =
  'An administrator changed the email address on your account. Open the confirmation page and enter this code to finish the change:';
export const EMAIL_CHANGE_NOTICE_BODY_TEXT =
  'An administrator requested to change the email address on your account. Your existing address remains active until the new address is confirmed. If you did not expect this request, contact your administrator.';

/** Prefix of the shutdown log line, shared with the specs. */
export const MAIL_DRAIN_DEADLINE_LOG = 'Mail drain deadline reached';

/** Minutes a code lives, from the configured lifetime, rounded down. */
export const MS_PER_MINUTE = 60 * 1000;

/**
 * "1 minute" or "N minutes": the one place a minute count is pluralized, so a
 * 60-second lifetime never prints "1 minutes".
 */
export function minutesLabel(minutes: number): string {
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * The sentence every code mail uses for its lifetime. Tests assert this with a
 * hand-written minute count instead of copying the text.
 */
export function codeExpirySentence(minutes: number): string {
  return `This code will expire in ${minutesLabel(minutes)}.`;
}

/** The magic-link lifetime sentence, sharing the same unit helper. */
export function magicLinkExpirySentence(minutes: number): string {
  return `The link expires in ${minutesLabel(minutes)}.`;
}
