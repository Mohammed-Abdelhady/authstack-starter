export const THROTTLE_TTL_15_MIN = 15 * 60 * 1000;

export const THROTTLE_LOGIN_LIMIT = 10;
export const THROTTLE_LOGIN_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_FORGOT_PASSWORD_LIMIT = 5;
export const THROTTLE_FORGOT_PASSWORD_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_RESET_PASSWORD_LIMIT = 10;
export const THROTTLE_RESET_PASSWORD_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_ACTIVATE_LIMIT = 10;
export const THROTTLE_ACTIVATE_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_REGISTER_LIMIT = 5;
export const THROTTLE_REGISTER_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_MAGIC_LINK_REQUEST_LIMIT = THROTTLE_FORGOT_PASSWORD_LIMIT;
export const THROTTLE_MAGIC_LINK_REQUEST_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_MAGIC_LINK_VERIFY_LIMIT = 10;
export const THROTTLE_MAGIC_LINK_VERIFY_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_TWO_FACTOR_VERIFY_LIMIT = 10;
export const THROTTLE_TWO_FACTOR_VERIFY_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_CHANGE_PASSWORD_LIMIT = 10;
export const THROTTLE_CHANGE_PASSWORD_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_PASSKEY_REGISTER_LIMIT = 10;
export const THROTTLE_PASSKEY_REGISTER_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_PASSKEY_LOGIN_LIMIT = 20;
export const THROTTLE_PASSKEY_LOGIN_TTL = THROTTLE_TTL_15_MIN;

export const THROTTLE_LOGIN = {
  default: {
    limit: THROTTLE_LOGIN_LIMIT,
    ttl: THROTTLE_LOGIN_TTL,
  },
} as const;

export const THROTTLE_FORGOT_PASSWORD = {
  default: {
    limit: THROTTLE_FORGOT_PASSWORD_LIMIT,
    ttl: THROTTLE_FORGOT_PASSWORD_TTL,
  },
} as const;

export const THROTTLE_RESET_PASSWORD = {
  default: {
    limit: THROTTLE_RESET_PASSWORD_LIMIT,
    ttl: THROTTLE_RESET_PASSWORD_TTL,
  },
} as const;

export const THROTTLE_ACTIVATE = {
  default: {
    limit: THROTTLE_ACTIVATE_LIMIT,
    ttl: THROTTLE_ACTIVATE_TTL,
  },
} as const;

export const THROTTLE_REGISTER = {
  default: {
    limit: THROTTLE_REGISTER_LIMIT,
    ttl: THROTTLE_REGISTER_TTL,
  },
} as const;

export const THROTTLE_MAGIC_LINK_REQUEST = {
  default: {
    limit: THROTTLE_MAGIC_LINK_REQUEST_LIMIT,
    ttl: THROTTLE_MAGIC_LINK_REQUEST_TTL,
  },
} as const;

export const THROTTLE_MAGIC_LINK_VERIFY = {
  default: {
    limit: THROTTLE_MAGIC_LINK_VERIFY_LIMIT,
    ttl: THROTTLE_MAGIC_LINK_VERIFY_TTL,
  },
} as const;

export const THROTTLE_TWO_FACTOR_VERIFY = {
  default: {
    limit: THROTTLE_TWO_FACTOR_VERIFY_LIMIT,
    ttl: THROTTLE_TWO_FACTOR_VERIFY_TTL,
  },
} as const;

/** A signed-in caller guessing the current password on the change route. */
export const THROTTLE_CHANGE_PASSWORD = {
  default: {
    limit: THROTTLE_CHANGE_PASSWORD_LIMIT,
    ttl: THROTTLE_CHANGE_PASSWORD_TTL,
  },
} as const;

/**
 * Covers both halves of a passkey sign-in. Higher than the password limit
 * because a client that cancels the browser prompt asks for fresh options.
 */
export const THROTTLE_PASSKEY_LOGIN = {
  default: {
    limit: THROTTLE_PASSKEY_LOGIN_LIMIT,
    ttl: THROTTLE_PASSKEY_LOGIN_TTL,
  },
} as const;

/** The options route for adding a passkey, which checks a password or a code. */
export const THROTTLE_PASSKEY_REGISTER = {
  default: {
    limit: THROTTLE_PASSKEY_REGISTER_LIMIT,
    ttl: THROTTLE_PASSKEY_REGISTER_TTL,
  },
} as const;
