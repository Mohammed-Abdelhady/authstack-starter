import 'reflect-metadata';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, Validate } from 'class-validator';
import {
  transformBoolean,
  transformOptionalString,
} from '../common/utils/environment-transform';
import { NativeEnvironmentVariables } from './env.native.schema';
import { DevelopmentOnlyConstraint } from './env.production.constraints';

/** Settings that exist only to be checked against NODE_ENV=production. */
export class ProductionGuardEnvironmentVariables extends NativeEnvironmentVariables {
  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  SWAGGER_ALLOW_IN_PRODUCTION: boolean = false;

  @Transform(transformOptionalString)
  @Validate(DevelopmentOnlyConstraint)
  @IsOptional()
  SEED_ADMIN_PASSWORD?: string;

  @Transform(transformOptionalString)
  @Validate(DevelopmentOnlyConstraint)
  @IsOptional()
  SEED_USER_PASSWORD?: string;

  @Transform(transformOptionalString)
  @Validate(DevelopmentOnlyConstraint)
  @IsOptional()
  SEED_PRINT_PASSWORDS?: string;

  @Transform(transformOptionalString)
  @Validate(DevelopmentOnlyConstraint)
  @IsOptional()
  SEED_PASSWORD_FILE?: string;
}
