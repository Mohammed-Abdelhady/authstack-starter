/**
 * Reply used by register, resend activation and forgot password.
 * All three answer the same way whether or not the address belongs to an
 * account, so none of them can be used to find out who has one.
 */
export const GENERIC_CODE_SENT_MESSAGE =
  'If an account exists, a code has been sent';

/**
 * Answer for any activation code step that cannot succeed.
 * Wrong code, no pending record, expired record and a locked record all get
 * this one body, so the answer cannot tell the cases apart.
 */
export const INVALID_ACTIVATION_CODE_MESSAGE =
  'Invalid or expired activation code';

/**
 * Answer for any password reset code step that cannot succeed.
 * Wrong code, no pending record, expired record and a locked record all get
 * this one body, so the answer cannot tell the cases apart.
 */
export const INVALID_PASSWORD_RESET_CODE_MESSAGE =
  'Invalid or expired password reset code';

/** Logged when an activation email is not handed over. */
export const ACTIVATION_EMAIL_FAILED_MESSAGE =
  'Failed to send activation email';

/** Logged when a password reset email is not handed over. */
export const PASSWORD_RESET_EMAIL_FAILED_MESSAGE =
  'Failed to send password reset email';

/** Logged when a sign-in link email is not handed over. */
export const SIGN_IN_LINK_EMAIL_FAILED_MESSAGE =
  'Failed to send sign-in link email';

/** Logged when a registration notice email is not handed over. */
export const REGISTRATION_NOTICE_EMAIL_FAILED_MESSAGE =
  'Failed to send registration notice email';

/** Logged when an email-change confirmation email is not handed over. */
export const EMAIL_CHANGE_EMAIL_FAILED_MESSAGE =
  'Failed to send email change confirmation email';

/** Logged when an existing address does not receive a pending-change notice. */
export const EMAIL_CHANGE_NOTICE_FAILED_MESSAGE =
  'Failed to send email change notice';

/**
 * Answer for an old-shape registration that still carries a password or a
 * name. It depends only on the body, never on the address.
 */
export const REGISTRATION_CONTRACT_OUTDATED_MESSAGE =
  'Registration takes the email address only; send the password and name when activating';
