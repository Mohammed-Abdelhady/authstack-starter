/**
 * Standard error codes for API responses.
 * Frontend can use these codes for i18n translation and programmatic error handling.
 */
export enum ErrorCode {
  // Authentication errors
  /** Invalid email or password provided */
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  /** Email address is already registered */
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',

  // Activation errors
  /**
   * Invalid activation code, no pending registration, an expired code or a
   * locked record. All four answer this one code.
   */
  ACTIVATION_CODE_INVALID = 'ACTIVATION_CODE_INVALID',
  /** No pending registration found for email */
  NO_PENDING_REGISTRATION = 'NO_PENDING_REGISTRATION',
  /**
   * A registration body still carries a password or a name. The contract
   * changed: registration takes the address only, activation takes the
   * password and the name. The answer depends only on the body.
   */
  REGISTRATION_CONTRACT_OUTDATED = 'REGISTRATION_CONTRACT_OUTDATED',

  // Email errors
  /** Failed to send email */
  EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED',
  /**
   * The per-address mailed-code cap is in force, so no code was sent. Distinct
   * from a transport failure so an admin knows when to retry.
   */
  EMAIL_SEND_LIMIT_REACHED = 'EMAIL_SEND_LIMIT_REACHED',

  // Magic link errors
  // feature:magic-link:start
  /** Magic link token is unknown, already used, or expired */
  MAGIC_LINK_INVALID = 'MAGIC_LINK_INVALID',
  // feature:magic-link:end

  // Two-factor errors
  // feature:totp:start
  /** Submitted TOTP code or recovery code did not match */
  TWO_FACTOR_CODE_INVALID = 'TWO_FACTOR_CODE_INVALID',
  /** Challenge cookie is missing, tampered with, expired, or out of attempts */
  TWO_FACTOR_CHALLENGE_INVALID = 'TWO_FACTOR_CHALLENGE_INVALID',
  /** Second factor is already confirmed on this account */
  TWO_FACTOR_ALREADY_ENABLED = 'TWO_FACTOR_ALREADY_ENABLED',
  /** Account has no confirmed second factor */
  TWO_FACTOR_NOT_ENABLED = 'TWO_FACTOR_NOT_ENABLED',
  /** Confirm was called without a pending secret from setup */
  TWO_FACTOR_SETUP_REQUIRED = 'TWO_FACTOR_SETUP_REQUIRED',
  /** TOTP_ENCRYPTION_KEY is missing or not 32 bytes */
  TWO_FACTOR_NOT_CONFIGURED = 'TWO_FACTOR_NOT_CONFIGURED',
  // feature:totp:end

  // Passkey errors
  // feature:passkeys:start
  /** Challenge cookie is missing, tampered with, expired, or for another step */
  PASSKEY_CHALLENGE_INVALID = 'PASSKEY_CHALLENGE_INVALID',
  // feature:passkeys:end
  /** Credential is unknown, its signature failed, or its counter went backwards */
  PASSKEY_VERIFICATION_FAILED = 'PASSKEY_VERIFICATION_FAILED',
  // feature:passkeys:start
  /** No passkey with that id on this account */
  PASSKEY_NOT_FOUND = 'PASSKEY_NOT_FOUND',
  /** Removing it would leave the account with no way to sign in */
  PASSKEY_LAST_SIGN_IN_METHOD = 'PASSKEY_LAST_SIGN_IN_METHOD',
  /** The secret the challenge cookie is signed with is missing */
  PASSKEY_NOT_CONFIGURED = 'PASSKEY_NOT_CONFIGURED',
  // feature:passkeys:end

  // Feature flag errors
  /** Route belongs to an authentication method this deployment turned off */
  FEATURE_DISABLED = 'FEATURE_DISABLED',
  /** Native OAuth and bearer authentication are disabled for this deployment */
  NATIVE_AUTH_DISABLED = 'NATIVE_AUTH_DISABLED',
  /** Native authorization transaction is unknown, expired, or already ended */
  NATIVE_TRANSACTION_EXPIRED = 'NATIVE_TRANSACTION_EXPIRED',
  /** The signed-in account is not the one the consent page displayed */
  NATIVE_AUTHORIZE_ACCOUNT_MISMATCH = 'NATIVE_AUTHORIZE_ACCOUNT_MISMATCH',
  NATIVE_DPOP_PROOF_TOO_LARGE = 'NATIVE_DPOP_PROOF_TOO_LARGE',
  NATIVE_DPOP_PROOF_MALFORMED = 'NATIVE_DPOP_PROOF_MALFORMED',
  NATIVE_DPOP_PROOF_DUPLICATE_MEMBER = 'NATIVE_DPOP_PROOF_DUPLICATE_MEMBER',
  NATIVE_DPOP_PROOF_HEADER_INVALID = 'NATIVE_DPOP_PROOF_HEADER_INVALID',
  NATIVE_DPOP_PROOF_ALGORITHM_INVALID = 'NATIVE_DPOP_PROOF_ALGORITHM_INVALID',
  NATIVE_DPOP_PROOF_JWK_INVALID = 'NATIVE_DPOP_PROOF_JWK_INVALID',
  NATIVE_DPOP_PROOF_SIGNATURE_INVALID = 'NATIVE_DPOP_PROOF_SIGNATURE_INVALID',
  NATIVE_DPOP_PROOF_METHOD_MISMATCH = 'NATIVE_DPOP_PROOF_METHOD_MISMATCH',
  NATIVE_DPOP_PROOF_ADDRESS_MISMATCH = 'NATIVE_DPOP_PROOF_ADDRESS_MISMATCH',
  NATIVE_DPOP_PROOF_IAT_INVALID = 'NATIVE_DPOP_PROOF_IAT_INVALID',
  NATIVE_DPOP_PROOF_JTI_INVALID = 'NATIVE_DPOP_PROOF_JTI_INVALID',
  NATIVE_DPOP_NONCE_REQUIRED = 'NATIVE_DPOP_NONCE_REQUIRED',
  NATIVE_DPOP_NONCE_INVALID = 'NATIVE_DPOP_NONCE_INVALID',
  NATIVE_DPOP_PROOF_ATH_INVALID = 'NATIVE_DPOP_PROOF_ATH_INVALID',
  NATIVE_DPOP_PROOF_REPLAYED = 'NATIVE_DPOP_PROOF_REPLAYED',
  NATIVE_DPOP_PROOF_REQUIRED = 'NATIVE_DPOP_PROOF_REQUIRED',
  NATIVE_DPOP_KEY_MISMATCH = 'NATIVE_DPOP_KEY_MISMATCH',
  NATIVE_DPOP_REQUIRED = 'NATIVE_DPOP_REQUIRED',
  NATIVE_DPOP_RETRY_IN_PROGRESS = 'NATIVE_DPOP_RETRY_IN_PROGRESS',
  NATIVE_DPOP_CONFIGURATION_INVALID = 'NATIVE_DPOP_CONFIGURATION_INVALID',

  // Session errors
  /** Authentication session required */
  SESSION_REQUIRED = 'SESSION_REQUIRED',
  /** Session is invalid or malformed */
  SESSION_INVALID = 'SESSION_INVALID',
  /** Session has expired */
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  /** Concurrent session cap would be exceeded */
  SESSION_LIMIT_REACHED = 'SESSION_LIMIT_REACHED',
  /** Authoritative session state could not be read */
  AUTHORITY_UNAVAILABLE = 'AUTHORITY_UNAVAILABLE',
  TRANSACTION_OUTCOME_UNKNOWN = 'TRANSACTION_OUTCOME_UNKNOWN',
  /** Registered application is missing */
  APPLICATION_NOT_FOUND = 'APPLICATION_NOT_FOUND',
  /** Registered application is disabled */
  APPLICATION_DISABLED = 'APPLICATION_DISABLED',
  /** User is blocked from this application */
  GRANT_BLOCKED = 'GRANT_BLOCKED',

  /** Unsafe request did not include the browser proof header */
  CSRF_REQUIRED = 'CSRF_REQUIRED',
  /** Presented browser proof does not match the session or was already used */
  CSRF_INVALID = 'CSRF_INVALID',
  /** Origin, referer, or fetch-site metadata is not allowed for this application */
  ORIGIN_REJECTED = 'ORIGIN_REJECTED',
  /** Cookie session and Authorization were both sent */
  MIXED_CREDENTIALS = 'MIXED_CREDENTIALS',

  // Verification errors
  /** Email address not verified */
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',

  // Validation errors
  /** Request validation failed */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Invalid input provided */
  INVALID_INPUT = 'INVALID_INPUT',

  // Rate limiting errors
  /** Rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Generic errors
  /** Internal server error */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** Resource not found */
  NOT_FOUND = 'NOT_FOUND',
  /** Access forbidden */
  FORBIDDEN = 'FORBIDDEN',
  /** Resource conflict */
  CONFLICT = 'CONFLICT',

  // Admin errors
  /** User does not exist */
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  /** Cannot change own role/status */
  CANNOT_MODIFY_SELF = 'CANNOT_MODIFY_SELF',
  /** Cannot modify user with higher role */
  CANNOT_MODIFY_HIGHER_ROLE = 'CANNOT_MODIFY_HIGHER_ROLE',
  /** Cannot assign ADMIN role via API */
  INVALID_ROLE_ASSIGNMENT = 'INVALID_ROLE_ASSIGNMENT',
  /** User is already deleted */
  USER_ALREADY_DELETED = 'USER_ALREADY_DELETED',

  // OAuth errors
  // feature:oauth-core:start
  /** Provider id is not in the OAuth registry */
  OAUTH_PROVIDER_UNKNOWN = 'OAUTH_PROVIDER_UNKNOWN',
  /** Provider has no credentials configured */
  OAUTH_NOT_CONFIGURED = 'OAUTH_NOT_CONFIGURED',
  /** State cookie is missing, tampered with, expired, or does not match */
  OAUTH_STATE_INVALID = 'OAUTH_STATE_INVALID',
  /** Authorization code could not be exchanged */
  OAUTH_CODE_INVALID = 'OAUTH_CODE_INVALID',
  /** Provider did not confirm the email address */
  OAUTH_EMAIL_UNVERIFIED = 'OAUTH_EMAIL_UNVERIFIED',
  /** Provider account is already linked to another user */
  OAUTH_ACCOUNT_LINKED_ELSEWHERE = 'OAUTH_ACCOUNT_LINKED_ELSEWHERE',
  /** OAuth authentication failed for any other reason */
  OAUTH_AUTHENTICATION_FAILED = 'OAUTH_AUTHENTICATION_FAILED',
  // feature:oauth-core:end

  // User self-service errors
  /** Current password is incorrect */
  INVALID_CURRENT_PASSWORD = 'INVALID_CURRENT_PASSWORD',
  /** New password is same as current */
  SAME_PASSWORD = 'SAME_PASSWORD',
  /** Session not found */
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  /** Cannot revoke current session */
  CANNOT_REVOKE_CURRENT_SESSION = 'CANNOT_REVOKE_CURRENT_SESSION',
  /** Admin cannot deactivate their own account */
  ADMIN_CANNOT_DEACTIVATE_SELF = 'ADMIN_CANNOT_DEACTIVATE_SELF',

  // Password reset errors
  /**
   * Invalid password reset code, no pending request, an expired code or a
   * locked record. All four answer this one code.
   */
  PASSWORD_RESET_CODE_INVALID = 'PASSWORD_RESET_CODE_INVALID',
  /** User not found for password reset */
  USER_NOT_FOUND_FOR_RESET = 'USER_NOT_FOUND_FOR_RESET',

  // Account linking errors
  // feature:oauth-core:start
  /** Provider is already linked to this account */
  PROVIDER_ALREADY_LINKED = 'PROVIDER_ALREADY_LINKED',
  /** Email mismatch when linking provider */
  EMAIL_MISMATCH_ON_LINK = 'EMAIL_MISMATCH_ON_LINK',
  /** Cannot unlink last authentication provider */
  CANNOT_UNLINK_LAST_PROVIDER = 'CANNOT_UNLINK_LAST_PROVIDER',
  /** Provider is not linked to this account */
  PROVIDER_NOT_LINKED = 'PROVIDER_NOT_LINKED',
  // feature:oauth-core:end
  /** Re-authentication required for sensitive operation */
  REAUTH_REQUIRED = 'REAUTH_REQUIRED',

  // Permission errors
  /** Permission already exists for user */
  PERMISSION_ALREADY_EXISTS = 'PERMISSION_ALREADY_EXISTS',
  /** Permission not found for user */
  PERMISSION_NOT_FOUND = 'PERMISSION_NOT_FOUND',
  /** Invalid permission format */
  INVALID_PERMISSION_FORMAT = 'INVALID_PERMISSION_FORMAT',

  // Role errors
  /** Role slug is not a stored role */
  ROLE_NOT_FOUND = 'ROLE_NOT_FOUND',
  /** Another role already has this name */
  ROLE_NAME_TAKEN = 'ROLE_NAME_TAKEN',
  /** The role is a system or protected role and cannot be deleted */
  ROLE_PROTECTED = 'ROLE_PROTECTED',
  /** Users still hold the role, so it cannot be deleted */
  ROLE_HAS_USERS = 'ROLE_HAS_USERS',
  /** A system role keeps its name */
  SYSTEM_ROLE_RENAME_FORBIDDEN = 'SYSTEM_ROLE_RENAME_FORBIDDEN',
  /** The admin role keeps the wildcard permission */
  ADMIN_WILDCARD_REQUIRED = 'ADMIN_WILDCARD_REQUIRED',
  /** Only admins may change another user's email address */
  EMAIL_CHANGE_NOT_ALLOWED = 'EMAIL_CHANGE_NOT_ALLOWED',
}
