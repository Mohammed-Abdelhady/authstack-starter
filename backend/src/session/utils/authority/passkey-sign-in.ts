import { FIRST_FACTOR } from '../../../auth/services/sessions/first-factor';
import type { BrowserEvidence } from '../../types/browser-evidence';
import { AudienceAdmissionRefused } from './audience-admission';

export const NATIVE_PASSKEY_AUTHENTICATION_METHOD = 'hwk';

/** Existing sign-in translators also map this refusal to their credential error. */
export class PasskeyRequiredRefused extends AudienceAdmissionRefused {}

export function assertPasskeySignIn(
  requirePasskey: boolean | undefined,
  evidence: BrowserEvidence | undefined,
  passkeyMethod: string = FIRST_FACTOR.PASSKEY,
): void {
  if (requirePasskey !== true) return;
  if (
    evidence?.userVerified === true &&
    evidence.authenticationMethods.includes(passkeyMethod)
  ) {
    return;
  }
  throw new PasskeyRequiredRefused();
}
