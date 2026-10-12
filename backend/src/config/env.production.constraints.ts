import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  PRODUCTION,
  PRODUCTION_DEVELOPMENT_ONLY_MESSAGE,
  PRODUCTION_PUBLIC_URL_MESSAGE,
  PRODUCTION_SWAGGER_MESSAGE,
  PRODUCTION_THROTTLE_MESSAGE,
  isProductionThrottle,
  isPublicHttpsUrl,
} from './utils/production-environment.util';

const inProduction = (validation: ValidationArguments): boolean =>
  Reflect.get(validation.object, 'NODE_ENV') === PRODUCTION;

/** A production server is reached over https on a host that is not this machine. */
@ValidatorConstraint({ name: 'productionPublicUrl' })
export class ProductionPublicUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    return !inProduction(validation) || isPublicHttpsUrl(value);
  }

  defaultMessage(validation: ValidationArguments): string {
    return `${validation.property} ${PRODUCTION_PUBLIC_URL_MESSAGE}`;
  }
}

/** The API explorer stays off in production unless a second setting allows it. */
@ValidatorConstraint({ name: 'productionSwagger' })
export class ProductionSwaggerConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    return (
      !inProduction(validation) ||
      value !== true ||
      Reflect.get(validation.object, 'SWAGGER_ALLOW_IN_PRODUCTION') === true
    );
  }

  defaultMessage(): string {
    return PRODUCTION_SWAGGER_MESSAGE;
  }
}

@ValidatorConstraint({ name: 'productionThrottle' })
export class ProductionThrottleConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    return (
      !inProduction(validation) ||
      isProductionThrottle(
        value,
        Reflect.get(validation.object, 'THROTTLE_TTL'),
      )
    );
  }

  defaultMessage(): string {
    return PRODUCTION_THROTTLE_MESSAGE;
  }
}

@ValidatorConstraint({ name: 'developmentOnly' })
export class DevelopmentOnlyConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, validation: ValidationArguments): boolean {
    return !inProduction(validation);
  }

  defaultMessage(validation: ValidationArguments): string {
    return `${validation.property} ${PRODUCTION_DEVELOPMENT_ONLY_MESSAGE}`;
  }
}
