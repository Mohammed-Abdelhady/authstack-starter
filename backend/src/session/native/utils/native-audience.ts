import type { RoleAudience } from '../../../host/types/host-role.type';
import {
  assertAudienceAdmission,
  AudienceAdmissionRefused,
} from '../../utils/authority/audience-admission';

/** The shared admission rule as an answer, for a step that refuses by returning. */
export function admitsAudience(
  accountAudience: RoleAudience | undefined,
  applicationAudience: RoleAudience | null | undefined,
): boolean {
  try {
    assertAudienceAdmission(accountAudience, applicationAudience);
    return true;
  } catch (error) {
    if (error instanceof AudienceAdmissionRefused) return false;
    throw error;
  }
}
