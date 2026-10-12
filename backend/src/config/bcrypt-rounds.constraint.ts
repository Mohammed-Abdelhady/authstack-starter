import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** The cost a server uses when the setting is absent. */
export const BCRYPT_ROUNDS_DEFAULT = 10;

/** Lowest cost a server that holds real passwords may start with. */
export const BCRYPT_ROUNDS_MIN = 10;

/** Lowest cost bcrypt takes. Only a test run may go this low. */
export const BCRYPT_ROUNDS_TEST_MIN = 4;

/**
 * Each step doubles the work. At 14 one hash takes about a second, and bcrypt
 * runs on four threads by default, so a server still finishes a few sign-ins a
 * second. One step more and a handful of sign-in attempts hold every thread.
 */
export const BCRYPT_ROUNDS_MAX = 14;

const TEST_ENVIRONMENT = 'test';

function lowestFor(environment: object): number {
  return Reflect.get(environment, 'NODE_ENV') === TEST_ENVIRONMENT
    ? BCRYPT_ROUNDS_TEST_MIN
    : BCRYPT_ROUNDS_MIN;
}

/** A whole number inside the bounds of the environment the server runs in. */
@ValidatorConstraint({ name: 'bcryptRounds' })
export class BcryptRoundsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validation: ValidationArguments): boolean {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= lowestFor(validation.object) &&
      value <= BCRYPT_ROUNDS_MAX
    );
  }

  defaultMessage(validation: ValidationArguments): string {
    return `BCRYPT_ROUNDS must be a whole number from ${lowestFor(validation.object)} to ${BCRYPT_ROUNDS_MAX}`;
  }
}
