import type { IssuanceApplication } from '../../../session/issuance/browser-issuance.store';
import type { PasskeyRelyingParty } from './passkey-relying-party';
import type { NativeSignInConfiguration } from '../../../config/types/native-application.type';

/** Missing policy fields mean today's open, unrestricted application policy. */
export interface IssuancePolicy extends IssuanceApplication {
  signIn?: NativeSignInConfiguration;
  passkeyRelyingParty: PasskeyRelyingParty | null;
}
