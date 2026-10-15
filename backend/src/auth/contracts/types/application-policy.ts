import type { IssuanceApplication } from '../../../session/issuance/browser-issuance.store';
import type { ApplicationPolicyConfiguration } from '../../../config/types/host-policy.type';
import type { NativeSignInConfiguration } from '../../../config/types/native-application.type';

/** Missing policy fields mean today's open, unrestricted application policy. */
export interface IssuancePolicy
  extends IssuanceApplication, ApplicationPolicyConfiguration {
  signIn?: NativeSignInConfiguration;
  policyVersion?: number;
}
