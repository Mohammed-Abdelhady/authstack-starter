import 'reflect-metadata';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { NATIVE_DPOP_SECRET_MIN_LENGTH } from '../session/constants/session-policy';
import { OAuthEnvironmentVariables } from './env.oauth.schema';
import {
  transformBoolean,
  transformOptionalString,
} from '../common/utils/environment-transform';
import { ProductionPublicUrlConstraint } from './env.production.constraints';
import {
  NATIVE_API_ORIGIN_MESSAGE,
  isNativeApiOrigin,
} from './utils/native-api-origin.util';

/** With native sign-in on, DPoP proofs are checked against this address. */
@ValidatorConstraint({ name: 'nativeApiOrigin' })
class NativeApiOriginConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    const environment = validation.object;
    if (!(environment instanceof NativeEnvironmentVariables)) {
      return false;
    }
    return (
      !environment.AUTH_NATIVE_ENABLED ||
      isNativeApiOrigin(value, Reflect.get(environment, 'NODE_ENV'))
    );
  }

  defaultMessage(): string {
    return NATIVE_API_ORIGIN_MESSAGE;
  }
}

export class NativeEnvironmentVariables extends OAuthEnvironmentVariables {
  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  AUTH_NATIVE_ENABLED: boolean = false;

  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  AUTH_NATIVE_DPOP_REQUIRED: boolean = false;

  @ValidateIf((value: NativeEnvironmentVariables) => value.AUTH_NATIVE_ENABLED)
  @IsString()
  @MinLength(NATIVE_DPOP_SECRET_MIN_LENGTH)
  AUTH_NATIVE_DPOP_NONCE_SECRET?: string;

  @ValidateIf(
    (value: NativeEnvironmentVariables) =>
      value.AUTH_NATIVE_ENABLED ||
      (value.API_URL !== undefined && value.API_URL !== null),
  )
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, require_tld: false })
  @Validate(NativeApiOriginConstraint)
  @Validate(ProductionPublicUrlConstraint)
  API_URL?: string;

  @Transform(transformOptionalString)
  @IsString()
  @IsOptional()
  AUTH_NATIVE_APPLICATIONS?: string;

  @Transform(transformBoolean(false))
  @IsBoolean()
  @IsOptional()
  AUTH_NATIVE_ALLOW_CUSTOM_SCHEME: boolean = false;
}
