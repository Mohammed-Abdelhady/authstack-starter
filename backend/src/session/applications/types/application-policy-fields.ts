import type { ApplicationPolicyConfiguration } from '../../../config/types/host-policy.type';
import type { RoleAudience } from '../../../host/types/host-role.type';
import type { ApplicationSignInMethods } from './application-sign-in-methods';

export interface ApplicationPolicyFields extends Omit<
  ApplicationPolicyConfiguration,
  'audience'
> {
  accountAudience?: RoleAudience;
  signInMethods?: ApplicationSignInMethods | null;
  policyVersion?: number;
  sessionCap?: number;
}
