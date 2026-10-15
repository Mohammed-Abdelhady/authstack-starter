import 'reflect-metadata';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsFQDN,
  IsInt,
  IsISO8601, // feature:email-code
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
  Validate,
} from 'class-validator';
import {
  parseOptionalInteger,
  transformBoolean,
  transformOptionalString,
} from '../common/utils/environment-transform';
import { ProductionGuardEnvironmentVariables } from './env.production.schema';
import { HostPolicyJsonConstraint } from './env.host-contracts.constraints';
import {
  ACTIVITY_RETENTION_DAYS_DEFAULT,
  EMAIL_CODE_EXPIRES_IN_DEFAULT, // feature:email-code
  INVITATION_EXPIRES_IN_DEFAULT, // feature:invitations
} from './constants/host-contracts';

/** Reserved settings. Consumers are introduced by plans 1 through 5. */
export class HostContractsEnvironmentVariables extends ProductionGuardEnvironmentVariables {
  @Transform(transformOptionalString)
  @IsUrl({ require_protocol: true, require_tld: false })
  @IsOptional()
  ADMIN_URL?: string;

  @Transform(transformBoolean(true))
  @IsBoolean()
  @IsOptional()
  AUTH_WEB_ENABLED: boolean = true;

  @Transform(transformOptionalString)
  @Validate(HostPolicyJsonConstraint)
  @IsOptional()
  AUTH_WEB_SIGN_IN?: string;

  @Transform(transformOptionalString)
  @Validate(HostPolicyJsonConstraint)
  @IsOptional()
  AUTH_ADMIN_SIGN_IN?: string;

  @Transform(transformOptionalString)
  @Validate(HostPolicyJsonConstraint)
  @IsOptional()
  AUTH_WEB_SESSION?: string;

  @Transform(transformOptionalString)
  @Validate(HostPolicyJsonConstraint)
  @IsOptional()
  AUTH_ADMIN_SESSION?: string;

  @Transform(transformOptionalString)
  @IsString()
  @IsFQDN({ require_tld: false })
  @IsOptional()
  AUTH_NATIVE_LINK_HOST?: string;

  // feature:email-code:start
  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  EMAIL_CODE_ENABLED: boolean = false;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  EMAIL_CODE_EXPIRES_IN: number = EMAIL_CODE_EXPIRES_IN_DEFAULT;

  @Transform(transformOptionalString)
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  EMAIL_CODE_REVIEW_ACCOUNT_ID?: string;

  @Transform(transformOptionalString)
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  EMAIL_CODE_REVIEW_CLIENT_ID?: string;

  @Transform(transformOptionalString)
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  EMAIL_CODE_REVIEW_CODE_HASH?: string;

  @Transform(transformOptionalString)
  @IsISO8601({ strict: true })
  @IsOptional()
  EMAIL_CODE_REVIEW_UNTIL?: string;
  // feature:email-code:end

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  ACTIVITY_RETENTION_DAYS: number = ACTIVITY_RETENTION_DAYS_DEFAULT;

  // feature:invitations:start
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  INVITATION_EXPIRES_IN: number = INVITATION_EXPIRES_IN_DEFAULT;
  // feature:invitations:end

  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  ADMIN_STRICT_MUTATIONS: boolean = false;

  @Transform(({ value }: { value: unknown }) => parseOptionalInteger(value))
  @IsInt()
  @Min(0)
  @IsOptional()
  ACCOUNT_ERASE_GRACE_DAYS?: number;

  @Transform(transformOptionalString)
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @IsOptional()
  PROVIDER_TOKEN_ENCRYPTION_KEY?: string;

  @Transform(transformOptionalString)
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @IsOptional()
  PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS?: string;
}
