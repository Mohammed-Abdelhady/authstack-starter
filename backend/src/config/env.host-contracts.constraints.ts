import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  parseBrowserSession,
  parseBrowserSignIn,
} from './utils/host-policy-config.util';
import { EMAIL_CODE_REVIEW_MAX_AHEAD_MS } from './constants/host-contracts'; // feature:email-code

// feature:email-code:start
const EMAIL_CODE_REVIEW_SETTINGS = [
  'EMAIL_CODE_REVIEW_ACCOUNT_ID',
  'EMAIL_CODE_REVIEW_CLIENT_ID',
  'EMAIL_CODE_REVIEW_CODE_HASH',
  'EMAIL_CODE_REVIEW_UNTIL',
] as const;

/**
 * Review access names an account, an application, a code and an end: all
 * four or none. A blank value counts as left out, because review access reads
 * each setting trimmed.
 */
@ValidatorConstraint({ name: 'emailCodeReviewGroup' })
export class EmailCodeReviewGroupConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, validation: ValidationArguments): boolean {
    return EMAIL_CODE_REVIEW_SETTINGS.every((setting) => {
      const value: unknown = Reflect.get(validation.object, setting);
      return typeof value === 'string' && value.trim() !== '';
    });
  }

  defaultMessage(validation: ValidationArguments): string {
    return `${validation.property} is one of ${EMAIL_CODE_REVIEW_SETTINGS.join(', ')}: set all four or none`;
  }
}

/** Review access ends at most 30 days after the server starts. */
@ValidatorConstraint({ name: 'emailCodeReviewUntil' })
export class EmailCodeReviewUntilConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      Date.parse(value) <= Date.now() + EMAIL_CODE_REVIEW_MAX_AHEAD_MS
    );
  }

  defaultMessage(validation: ValidationArguments): string {
    return `${validation.property} must be at most 30 days ahead`;
  }
}
// feature:email-code:end

/**
 * The previous provider token key only reads tokens written before a rotation,
 * so it needs a current key beside it, and a different one.
 */
@ValidatorConstraint({ name: 'providerTokenPreviousKey' })
export class ProviderTokenPreviousKeyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    const current: unknown = Reflect.get(
      validation.object,
      'PROVIDER_TOKEN_ENCRYPTION_KEY',
    );
    return (
      typeof value === 'string' &&
      typeof current === 'string' &&
      current.trim() !== '' &&
      current !== value
    );
  }

  defaultMessage(validation: ValidationArguments): string {
    return `${validation.property} needs PROVIDER_TOKEN_ENCRYPTION_KEY set to a different key`;
  }
}

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
