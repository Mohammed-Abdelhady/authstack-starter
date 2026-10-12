import {
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';

export type NativeAttemptFlow =
  (typeof NATIVE_ATTEMPT_FLOW)[keyof typeof NATIVE_ATTEMPT_FLOW];
export type NativeAttemptPhase =
  (typeof NATIVE_ATTEMPT_PHASE)[keyof typeof NATIVE_ATTEMPT_PHASE];

export interface VerifiedNativeAccount {
  userId: string;
  userVersion: number;
  clientVersion: number;
  grantVersion: number | null;
  authenticationMethods: string[];
  verifiedAt: Date;
  firstFactor: 'password' | 'provider' | 'passkey' | 'emailLink' | 'emailCode';
}

/** Only a server verifier may supply this after checking its own credential. */
export interface VerifiedNativePrincipal {
  userId: string;
  userVersion: number;
  firstFactor: VerifiedNativeAccount['firstFactor'];
  authenticationMethods: string[];
  /** Set only by a server passkey verifier after checking the UV flag. */
  passkeyUserVerified?: boolean;
}

export interface NativeAttemptEmailState {
  address: string;
  generation: number | null;
  requestedAt: Date | null;
}

/** Ciphertext is bound to the attempt secret outside this store. */
export interface EncryptedNativeCodeReply {
  ciphertext: string;
  iv: string;
  tag: string;
  expiresAt: Date;
}

export interface NativeAttemptDetails {
  policyHash?: string;
  verifiedAccount: VerifiedNativeAccount | null;
  nonceDigest: string | null;
  email: NativeAttemptEmailState | null;
  codeReply: EncryptedNativeCodeReply | null;
  secondFactors?: ('totp' | 'recoveryCode' | 'passkey')[];
  activationCompleted?: boolean;
  passkeyChallengeHash?: string | null;
  passkeyPurpose?: 'firstFactor' | 'secondFactor' | null;
  emailTokenHash?: string | null;
}

export interface NativeAttempt {
  id: string;
  attemptId: string;
  secretHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  requestedScopes: string[];
  flow: NativeAttemptFlow;
  phase: NativeAttemptPhase;
  authEpoch: number;
  createdAt: Date;
  expiresAt: Date;
  revision: number;
  activeOperationId: string | null;
  cancelledAt: Date | null;
  details: NativeAttemptDetails;
}

export type NewNativeAttempt = Omit<
  NativeAttempt,
  'id' | 'revision' | 'activeOperationId' | 'cancelledAt'
>;
export type NativeAttemptCredentials = Pick<
  NativeAttempt,
  'attemptId' | 'clientId' | 'secretHash'
>;
export interface NativeAttemptGuard extends NativeAttemptCredentials {
  revision: number;
}
export interface NativeAttemptOperationGuard extends NativeAttemptGuard {
  operationId: string;
}
export interface NativeAttemptTransition {
  phase: NativeAttemptPhase;
  expiresAt: Date;
  details: NativeAttemptDetails;
}
