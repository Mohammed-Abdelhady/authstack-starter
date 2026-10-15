import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  parseBrowserSession,
  parseBrowserSignIn,
} from './utils/host-policy-config.util';

@ValidatorConstraint({ name: 'hostPolicyJson' })
export class HostPolicyJsonConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    try {
      if (validation.property.endsWith('_SESSION')) {
        parseBrowserSession(value, validation.property);
      } else {
        parseBrowserSignIn(value, validation.property);
      }
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(validation: ValidationArguments): string {
    const value: unknown = validation.value;
    if (typeof value === 'string') {
      try {
        if (validation.property.endsWith('_SESSION')) {
          parseBrowserSession(value, validation.property);
        } else {
          parseBrowserSignIn(value, validation.property);
        }
      } catch (error) {
        if (error instanceof Error) return error.message;
      }
    }
    return `${validation.property} must contain a valid application policy JSON object`;
  }
}

@ValidatorConstraint({ name: 'distinctAdminOrigin' })
export class DistinctAdminOriginConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    const clientUrl: unknown = Reflect.get(validation.object, 'CLIENT_URL');
    if (typeof value !== 'string' || typeof clientUrl !== 'string')
      return false;
    try {
      return new URL(value).origin !== new URL(clientUrl).origin;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'ADMIN_URL must have a different origin from CLIENT_URL';
  }
}
