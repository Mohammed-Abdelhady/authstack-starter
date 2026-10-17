export interface ProofCodeResult {
  expiresInMinutes: number;
}

export interface FreshProof {
  provedAt: string;
}

// feature:passkeys:start
import type { NativePasskeyOptions } from './native-auth';

import type { BROWSER_AUTHENTICATOR_TRANSPORTS } from '../proof/constants';

export type BrowserAuthenticatorTransport = (typeof BROWSER_AUTHENTICATOR_TRANSPORTS)[number];

export interface BrowserPasskeyProofOptions extends Omit<
  NativePasskeyOptions,
  'allowCredentials' | 'rpId' | 'userVerification'
> {
  rpId: string;
  userVerification: 'required';
  allowCredentials?: {
    type: 'public-key';
    id: string;
    transports?: BrowserAuthenticatorTransport[];
  }[];
}
// feature:passkeys:end
