/** Facts returned by successful server verification, never request fields. */
export interface VerifiedPasskeyProof {
  readonly userId: string;
  readonly rpId: string;
  readonly credentialId: string;
  readonly userVerified: boolean;
}
