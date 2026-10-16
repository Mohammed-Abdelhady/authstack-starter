import {
  PASSKEY_CEREMONY,
  PasskeyCeremony,
  USER_VERIFICATION,
  UserVerificationRequirement,
} from '../constants/passkeys.constants';

/** What decides whether a registration must verify its user. */
export interface RegistrationPolicy {
  /** The route the ceremony runs on. */
  readonly ceremony: PasskeyCeremony;
  /** The application admits its users with a passkey only. */
  readonly requirePasskey: boolean;
  /** The session exists only to enrol the first passkey. */
  readonly enrolment: boolean;
}

/**
 * A passkey made in a mobile app always verifies its user. In a browser it
 * must when it will be the only way in or turns an enrolment session into a
 * full one; otherwise today's rule holds: asked for, not required.
 */
export function registrationRequiresUserVerification(
  policy: RegistrationPolicy,
): boolean {
  return (
    policy.ceremony === PASSKEY_CEREMONY.NATIVE ||
    policy.requirePasskey ||
    policy.enrolment
  );
}

/** The same decision, as the ceremony's requirement. */
export function registrationUserVerification(
  policy: RegistrationPolicy,
): UserVerificationRequirement {
  return registrationRequiresUserVerification(policy)
    ? USER_VERIFICATION.REQUIRED
    : USER_VERIFICATION.PREFERRED;
}
