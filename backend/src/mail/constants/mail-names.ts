export const MAIL_NAME = {
  ACTIVATION_CODE: 'activationCode',
  EMAIL_CHANGE_CODE: 'emailChangeCode',
  EMAIL_CHANGE_NOTICE: 'emailChangeNotice',
  PASSWORD_RESET_CODE: 'passwordResetCode',
  PROOF_CODE: 'proofCode',
  // feature:invitations:start
  INVITATION: 'invitation',
  ENROLMENT: 'enrolment',
  // feature:invitations:end
  MAGIC_LINK: 'magicLink',
  REGISTRATION_NOTICE: 'registrationNotice',
  SECURITY_NOTICE: 'securityNotice',
} as const;

export type MailName = (typeof MAIL_NAME)[keyof typeof MAIL_NAME];

/** Client page the admin email-change mail points at. */
export const EMAIL_CHANGE_CONFIRM_PATH = '/auth/confirm-email-change';

/**
 * Client page a sign-in link opens. It reads the token out of the query
 * string and posts it to the backend, so a scanner that fetches the link does
 * not consume it.
 */
export const MAGIC_LINK_PATH = '/auth/magic-link/verify';

/**
 * Each mail that carries a link the server builds, with the path its link has
 * when no template is set: today's fixed path under `CLIENT_URL`.
 */
export const MAIL_LINK_PATHS = {
  [MAIL_NAME.EMAIL_CHANGE_CODE]: EMAIL_CHANGE_CONFIRM_PATH,
  [MAIL_NAME.MAGIC_LINK]: MAGIC_LINK_PATH,
  // feature:invitations:start
  [MAIL_NAME.INVITATION]: '/auth/invitation',
  [MAIL_NAME.ENROLMENT]: '/auth/invitation',
  // feature:invitations:end
} as const;

export const REQUIRED_MAIL_LINK_NAMES = [
  MAIL_NAME.EMAIL_CHANGE_CODE,
  MAIL_NAME.MAGIC_LINK,
] as const;

export type LinkedMailName = keyof typeof MAIL_LINK_PATHS;

export function isLinkedMailName(name: string): name is LinkedMailName {
  return Object.hasOwn(MAIL_LINK_PATHS, name);
}

export const LINKED_MAIL_NAMES: readonly LinkedMailName[] =
  Object.keys(MAIL_LINK_PATHS).filter(isLinkedMailName);
