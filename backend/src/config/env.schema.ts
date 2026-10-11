import 'reflect-metadata';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  Validate,
} from 'class-validator';
import {
  BCRYPT_ROUNDS_DEFAULT,
  BcryptRoundsConstraint,
} from './bcrypt-rounds.constraint';
import { OAuthEnvironmentConfig } from './env.oauth.schema';
import { NativeEnvironmentVariables } from './env.native.schema';
import {
  transformBoolean,
  transformOptionalString,
} from '../common/utils/environment-transform';
export {
  transformBoolean,
  transformOptionalString,
} from '../common/utils/environment-transform';
import {
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  ACTIVATION_CODE_EXPIRES_IN_MAX,
} from '../auth/constants/registration';
import {
  MAIL_DRAIN_DEADLINE_MS,
  MAIL_MAX_PENDING_SENDS,
} from '../mail/constants/mail.constants';

export interface EnvironmentConfig extends OAuthEnvironmentConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  MONGO_URI: string; // feature:mongodb
  DATABASE_TYPE?: 'mongodb' | 'postgres'; // feature:database-choice
  POSTGRES_URL?: string; // feature:postgres
  POSTGRES_POOL_MAX?: number; // feature:postgres
  CLIENT_URL: string;
  API_URL?: string;
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
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_ORIGIN?: string;

  SWAGGER_ENABLED?: boolean;
  PROFILE_SYNC_ENABLED?: boolean;
  PROFILE_SYNC_FIELDS?: string;
}

/** 32 bytes in base64: 43 characters and one of padding. */
const TOTP_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

export class EnvironmentVariables extends NativeEnvironmentVariables {
  @IsEnum(['development', 'production', 'test'])
  @IsOptional()
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, require_tld: false })
  @IsOptional()
  CLIENT_URL: string = 'http://localhost:3000';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3600)
  @IsOptional()
  THROTTLE_TTL: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  THROTTLE_LIMIT: number = 60;

  @IsString()
  @IsOptional()
  SMTP_HOST?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  SMTP_PORT?: number;

  @Transform(transformBoolean())
  @IsBoolean()
  @IsOptional()
  SMTP_SECURE?: boolean;

  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASS?: string;

  @IsString()
  @IsOptional()
  EMAIL_FROM?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  MAIL_MAX_PENDING_SENDS: number = MAIL_MAX_PENDING_SENDS;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60000)
  @IsOptional()
  MAIL_DRAIN_DEADLINE_MS: number = MAIL_DRAIN_DEADLINE_MS;

  @Type(() => Number)
  @Validate(BcryptRoundsConstraint)
  @IsOptional()
  BCRYPT_ROUNDS: number = BCRYPT_ROUNDS_DEFAULT;

  @IsString()
  @IsOptional()
  SESSION_COOKIE_NAME?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @IsOptional()
  SESSION_COOKIE_MAX_AGE: number = 604800000;

  @Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.trim() !== value || !/^[0-9]+$/.test(value)) {
      return value;
    }
    return Number(value);
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  AUTH_EPOCH: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(60000)
  @Max(ACTIVATION_CODE_EXPIRES_IN_MAX)
  @IsOptional()
  ACTIVATION_CODE_EXPIRES_IN: number = ACTIVATION_CODE_EXPIRES_IN_DEFAULT;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  ACTIVATION_MAX_ATTEMPTS: number = 5;

  @Transform(transformBoolean(true))
  @IsBoolean()
  @IsOptional()
  AUTH_PASSWORD_ENABLED: boolean = true;

  /**
   * Left unset, magic links follow SMTP: on when a host and a sender address
   * are configured, off otherwise. configuration.ts resolves that default.
   */
  @Transform(transformBoolean())
  @IsBoolean()
  @IsOptional()
  MAGIC_LINK_ENABLED?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(60000)
  @IsOptional()
  MAGIC_LINK_EXPIRES_IN: number = 900000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  MAGIC_LINK_MAX_PER_HOUR: number = 5;

  @Transform(transformBoolean(true))
  @IsBoolean()
  @IsOptional()
  TWO_FACTOR_ENABLED: boolean = true;

  /**
   * Optional at boot on purpose. A deployment that never turns two-factor on
   * should not have to hold a key, so the missing key is reported by the first
   * request that needs it rather than by a failed start.
   */
  @Transform(transformOptionalString)
  @IsString()
  @IsOptional()
  @Matches(TOTP_KEY_PATTERN, {
    message:
      'TOTP_ENCRYPTION_KEY must be 32 bytes in base64, as produced by `openssl rand -base64 32`',
  })
  TOTP_ENCRYPTION_KEY?: string;

  /**
   * The key before TOTP_ENCRYPTION_KEY, set only while that key is being
   * replaced. To rotate: move the current key here, put a new key in
   * TOTP_ENCRYPTION_KEY and restart. A secret still stored under the old key
   * is read with it and written again under the new one the next time its
   * account answers a code. Remove this setting once no stored secret names
   * the old key: a secret left under it stops working then. Sign-ins waiting
   * for a code when the key changes start again.
   */
  @Transform(transformOptionalString)
  @IsString()
  @IsOptional()
  @Matches(TOTP_KEY_PATTERN, {
    message:
      'TOTP_ENCRYPTION_KEY_PREVIOUS must be 32 bytes in base64, as produced by `openssl rand -base64 32`',
  })
  TOTP_ENCRYPTION_KEY_PREVIOUS?: string;

  @Transform(transformBoolean(true))
  @IsBoolean()
  @IsOptional()
  PASSKEYS_ENABLED: boolean = true;

  /**
   * Domain the credentials are bound to. Left unset it follows the hostname of
   * CLIENT_URL, which is right whenever the client and the passkey prompt share
   * a domain. A credential registered under one RP id cannot be used under
   * another, so changing this invalidates every stored passkey.
   */
  @Transform(transformOptionalString)
  @IsString()
  @IsOptional()
  WEBAUTHN_RP_ID?: string;

  /** Name the browser shows in the passkey prompt. */
  @Transform(transformOptionalString)
  @IsString()
  @IsOptional()
  WEBAUTHN_RP_NAME?: string;

  /** Origin the browser must be on. Defaults to the origin of CLIENT_URL. */
  @Transform(transformOptionalString)
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @IsOptional()
  WEBAUTHN_ORIGIN?: string;

  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  SWAGGER_ENABLED: boolean = false;

  @Transform(transformBoolean(true))
  @IsBoolean()
  @IsOptional()
  PROFILE_SYNC_ENABLED: boolean = true;

  @IsString()
  @IsOptional()
  PROFILE_SYNC_FIELDS: string = 'name,picture';
}
