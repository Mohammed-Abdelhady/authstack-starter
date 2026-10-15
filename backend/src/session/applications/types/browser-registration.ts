import type { FirstPartyRegistration } from '../application-registry.store';
import type { RoleAudience } from '../../../host/types/host-role.type';
import type { ApplicationSignInMethods } from './application-sign-in-methods';

/** A complete browser policy, written against the snapshot reconciliation read. */
export interface BrowserRegistration extends Omit<
  FirstPartyRegistration,
  'accountAudience' | 'policyVersion' | 'signInMethods'
> {
  readonly expectedPolicyVersion: number | null;
  policyVersion: number;
  accountAudience: RoleAudience | null;
  signInMethods: ApplicationSignInMethods | null;
  enabled?: boolean;
}
