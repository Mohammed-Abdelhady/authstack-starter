import type { CredentialPurpose } from '../../../session/constants/credential-purpose';
import type { OWN_EMAIL_PROOF } from '../constants/own-email';

export type OwnEmailProof =
  (typeof OWN_EMAIL_PROOF)[keyof typeof OWN_EMAIL_PROOF];

/** The session a request arrived on, as the guard validated it. */
export interface OwnEmailCaller {
  userId: string;
  sessionId: string;
  clientId: string;
  /** The actual authentication time, retained through native consent. */
  signedInAt: Date;
  /** A browser session, or a mobile app's access token. */
  credentialPurpose: CredentialPurpose;
}

/** The account's address and the one it waits to confirm. */
export interface OwnEmailState {
  email: string;
  pendingEmail?: string;
}
