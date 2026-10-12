/** The role the server never lets the API hand out. */
export const ADMIN_ROLE_SLUG = 'admin';

/** The role a new account gets unless another is chosen. */
export const DEFAULT_ROLE_SLUG = 'user';

/** The level the server gives a role slug it has no role for. */
export const UNKNOWN_ROLE_LEVEL = 0;

/** The largest page the roles list route accepts. */
export const ROLE_LIST_MAX_PAGE_SIZE = 100;

/**
 * The most pages one read of every role asks for: 2000 roles. A list longer
 * than that fails to load, which a selector shows, where a shorter list would
 * pass for the whole one.
 */
export const ROLE_LIST_MAX_PAGES = 20;

/** The error of a role list longer than the pages above hold. */
export const ROLE_LIST_TOO_LONG = 'ROLE_LIST_TOO_LONG';

/** Why the server would refuse to hand a role out. */
export const ROLE_REFUSAL = {
  /** The admin role is out of reach of the API, whoever asks. */
  ADMIN: 'admin',
  /** The role sits at or above the level of the person assigning it. */
  LEVEL: 'level',
} as const;

export type RoleRefusal = (typeof ROLE_REFUSAL)[keyof typeof ROLE_REFUSAL];
