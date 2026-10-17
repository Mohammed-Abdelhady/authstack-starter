import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '../utils/webauthn';

/** One passkey as the account settings show it. No key material is sent. */
export interface PasskeySummary {
  id: string;
  name: string;
  /** singleDevice for a key bound to one device, multiDevice for a synced one. */
  deviceType?: string;
  /** Whether the credential is synced to a provider keychain. */
  backedUp: boolean;
  createdAt: string;
  /** Null until the passkey has signed in once. */
  lastUsedAt: string | null;
  canRemove?: boolean;
  removalBlockedCode?: string;
}

/** Payload of GET /auth/passkeys. */
export interface PasskeyListResponse {
  passkeys: PasskeySummary[];
  /**
   * False when the server would refuse to remove a listed passkey because it
   * is the last way in. Absent from a server that predates the hint.
   */
  canRemove?: boolean;
}

/** Body of POST /auth/passkeys/register/verify. */
export interface RegisterPasskeyRequest {
  response: RegistrationResponseJSON;
  name?: string;
}

/** Fresh proof accepted by the registration-options endpoint. */
export interface PasskeyRegistrationProof {
  password?: string;
  code?: string;
  recoveryCode?: string;
}

export type PasskeyRegistrationRequirement = 'password' | 'recent_sign_in' | 'second_factor';

/** Body of POST /auth/passkeys/login/verify. */
export interface PasskeyLoginRequest {
  response: AuthenticationResponseJSON;
}

/** Body of POST /auth/2fa/verify when a passkey answers the challenge. */
export interface PasskeyTwoFactorRequest {
  passkeyResponse: AuthenticationResponseJSON;
}

/** Body of PATCH /auth/passkeys/:id. */
export interface RenamePasskeyRequest {
  id: string;
  name: string;
}

/** Why the name dialog is open. */
export const PASSKEY_NAME_MODE = {
  /** Straight after the ceremony, over the name taken from the device. */
  CREATE: 'create',
  RENAME: 'rename',
} as const;

export type PasskeyNameMode = (typeof PASSKEY_NAME_MODE)[keyof typeof PASSKEY_NAME_MODE];

/** What the name dialog is open for. */
export interface PasskeyNameTarget {
  passkey: PasskeySummary;
  mode: PasskeyNameMode;
}

/** Whether this browser can run a ceremony, before and after the check. */
export const PASSKEY_SUPPORT = {
  CHECKING: 'checking',
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
} as const;

export type PasskeySupport = (typeof PASSKEY_SUPPORT)[keyof typeof PASSKEY_SUPPORT];
