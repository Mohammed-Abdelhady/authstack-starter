import { OAuthEnvironmentConfig } from '../env.oauth.schema';

export interface EnvironmentConfig extends OAuthEnvironmentConfig {
  ADMIN_URL?: string;
  AUTH_WEB_ENABLED?: boolean;
  AUTH_WEB_SIGN_IN?: string;
  AUTH_ADMIN_SIGN_IN?: string;
  AUTH_WEB_SESSION?: string;
  AUTH_ADMIN_SESSION?: string;
  AUTH_NATIVE_LINK_HOST?: string;
  // feature:email-code:start
  EMAIL_CODE_ENABLED?: boolean;
  EMAIL_CODE_EXPIRES_IN?: number;
  EMAIL_CODE_REVIEW_ACCOUNT_ID?: string;
  EMAIL_CODE_REVIEW_CLIENT_ID?: string;
  EMAIL_CODE_REVIEW_CODE_HASH?: string;
  EMAIL_CODE_REVIEW_UNTIL?: string;
  // feature:email-code:end
  ACTIVITY_RETENTION_DAYS?: number;
  INVITATION_EXPIRES_IN?: number; // feature:invitations
  ADMIN_STRICT_MUTATIONS?: boolean;
  ACCOUNT_ERASE_GRACE_DAYS?: number;
  PROVIDER_TOKEN_ENCRYPTION_KEY?: string;
  PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS?: string;
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  MONGO_URI: string; // feature:mongodb
  DATABASE_TYPE?: 'mongodb' | 'postgres'; // feature:database-choice
  POSTGRES_URL?: string; // feature:postgres
  POSTGRES_POOL_MAX?: number; // feature:postgres
  CLIENT_URL: string;
  API_URL?: string;
  SERVER_COMMIT_SHA?: string;
  THROTTLE_TTL: number;
  THROTTLE_LIMIT: number;

  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_FROM?: string;
  MAIL_MAX_PENDING_SENDS?: number;
  MAIL_DRAIN_DEADLINE_MS?: number;
  MAIL_LINKS_CUSTOMER?: string;
  MAIL_LINKS_STAFF?: string;

  BCRYPT_ROUNDS?: number;

  SESSION_COOKIE_NAME?: string;
  SESSION_COOKIE_MAX_AGE?: number;

  AUTH_EPOCH?: number;
  AUTH_NATIVE_ENABLED?: boolean;
  AUTH_NATIVE_DPOP_REQUIRED?: boolean;
  AUTH_NATIVE_DPOP_NONCE_SECRET?: string;
  AUTH_NATIVE_APPLICATIONS?: string;
  AUTH_NATIVE_ALLOW_CUSTOM_SCHEME?: boolean;

  ACTIVATION_CODE_EXPIRES_IN?: number;
  ACTIVATION_MAX_ATTEMPTS?: number;

  AUTH_PASSWORD_ENABLED?: boolean;

  MAGIC_LINK_ENABLED?: boolean;
  MAGIC_LINK_EXPIRES_IN?: number;
  MAGIC_LINK_MAX_PER_HOUR?: number;

  TWO_FACTOR_ENABLED?: boolean;
  TOTP_ENCRYPTION_KEY?: string;
  TOTP_ENCRYPTION_KEY_PREVIOUS?: string;

  PASSKEYS_ENABLED?: boolean;
  PASSKEY_CHALLENGE_SECRET?: string;
  PASSKEY_CHALLENGE_SECRET_PREVIOUS?: string;
  PASSKEY_CHALLENGE_LEGACY_UNTIL?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_ORIGIN?: string;

  SWAGGER_ENABLED?: boolean;
  SWAGGER_ALLOW_IN_PRODUCTION?: boolean;
  PROFILE_SYNC_ENABLED?: boolean;
  PROFILE_SYNC_FIELDS?: string;
}
