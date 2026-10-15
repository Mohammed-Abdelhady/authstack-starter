import { FIRST_FACTOR } from '../../../auth/services/sessions/first-factor';
import type { BrowserEvidence } from '../../types/browser-evidence';
import { AudienceAdmissionRefused } from './audience-admission';

/** Existing sign-in translators also map this refusal to their credential error. */
export class PasskeyRequiredRefused extends AudienceAdmissionRefused {}

export function assertPasskeySignIn(
  requirePasskey: boolean | undefined,
  evidence: BrowserEvidence | undefined,
): void {
  if (requirePasskey !== true) return;
  if (
    evidence?.userVerified === true &&
    evidence.authenticationMethods.includes(FIRST_FACTOR.PASSKEY)
  ) {
    return;
  }
  throw new PasskeyRequiredRefused();
}
