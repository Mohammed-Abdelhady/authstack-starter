/** One passkey as the account settings show it. No key material is sent. */
export interface PasskeySummary {
  id: string;
  name: string;
  /** `singleDevice` for a key bound to one device, else `multiDevice`. */
  deviceType?: string;
  backedUp: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, null until the passkey first signs in. */
  lastUsedAt: string | null;
}

export interface PasskeyList {
  passkeys: PasskeySummary[];
  /** Advice only: whether removing one would be accepted now. The removal still decides. */
  canRemove?: boolean;
}

export interface PasskeyCredentialDescriptorJson {
  type: 'public-key';
  id: string;
  transports?: string[];
}

export type PasskeyUserVerification = 'required' | 'preferred' | 'discouraged';

/** Options for the system prompt that makes a passkey, as the server sends them. */
export interface PasskeyCreationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number;
  excludeCredentials?: PasskeyCredentialDescriptorJson[];
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    residentKey?: 'discouraged' | 'preferred' | 'required';
    requireResidentKey?: boolean;
    userVerification?: PasskeyUserVerification;
  };
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise';
  extensions?: { credProps?: boolean };
}

/** What the authenticator made, as the verify route takes it. */
export interface PasskeyAttestation {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorAttachment?: 'platform' | 'cross-platform';
  clientExtensionResults?: Readonly<Record<string, unknown>>;
}

export interface PasskeyRegistrationInput {
  response: PasskeyAttestation;
  /** Shown in the account settings. The server names a passkey sent without one. */
  name?: string;
}
