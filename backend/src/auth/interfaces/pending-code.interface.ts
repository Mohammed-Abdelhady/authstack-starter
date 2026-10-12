import { PendingPurpose } from '../constants/registration';

/**
 * An id as the storage seam hands it out, a string, or the object an older
 * caller still holds. Either way only its text is used.
 */
export type IdSource = string | { toString(): string };

/** The plain code to mail, or null when the address is over its cap. */
export interface IssuedCode {
  code: string;
}

/** What a pending record carries once its code compared successfully. */
export interface ReservedCode {
  id: IdSource;
  email: string;
  purpose: PendingPurpose;
  hashedCode: string;
  userId?: IdSource;
  addressGeneration?: number;
}

/** Target user and generation, for an email-change record only. */
export interface RegistrationDetails {
  userId?: IdSource;
  addressGeneration?: number;
}

/** Outcome of a live-record refresh. */
export type RefreshOutcome =
  | { kind: 'refreshed'; issued: IssuedCode }
  | { kind: 'limited' }
  | { kind: 'none' };
