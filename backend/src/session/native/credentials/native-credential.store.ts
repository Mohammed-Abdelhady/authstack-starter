import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { CredentialPurpose } from '../../constants/credential-purpose';
import { SessionDeviceLabel } from '../../issuance/browser-issuance.store';
import { SessionAuthorityFields } from '../../utils/authority/session-authority-rule';

/** Shared name of the rule that lets a proof id be stored once, on any database. */
export const NATIVE_CONSTRAINT = {
  PROOF_ID: 'native_dpop_proof_id_unique',
} as const;

export interface StoredNativeCredential {
  id: string;
  purpose: CredentialPurpose;
  sessionId: string;
  clientId: string;
  generation: number;
  familyId: string;
  expiresAt: Date;
  spent: boolean;
  consumedAt: Date | null;
  revokedAt: Date | null;
  proofKeyThumbprint: string | null;
  successorAccessHash: string | null;
  successorRefreshHash: string | null;
}

/** The session a token family belongs to, with what a new pair is cut from. */
export interface NativeFamilySession extends SessionAuthorityFields {
  id: string;
  userId: string;
  scopes: string[];
  audience: string;
  authenticationMethods: string[];
  proofKeyThumbprint: string | null;
}

export interface NewNativeSession {
  userId: string;
  tokenHash: string;
  userAgent: string;
  device: SessionDeviceLabel;
  deviceName?: string;
  ip: string;
  clientId: string;
  userVersion: number;
  clientVersion: number;
  grantVersion: number;
  authEpoch: number;
  schemaVersion: number;
  scopes: string[];
  audience: string;
  authenticationMethods: string[];
  credentialPurpose: CredentialPurpose;
  authenticatedAt: Date;
  lastUsedAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
  proofKeyThumbprint?: string;
}

export interface NewCredentialPair {
  sessionId: string;
  clientId: string;
  generation: number;
  familyId: string;
  issuedAt: Date;
  proofKeyThumbprint?: string;
  access: { tokenHash: string; expiresAt: Date };
  refresh: { tokenHash: string; expiresAt: Date };
}

export interface FamilyRevocation {
  familyId: string;
  sessionId: string;
  now: Date;
  reason: string;
}

/** Who the ended session belonged to, for the event. */
export interface EndedFamilyOwner {
  userId: string;
  clientId: string;
}

export interface NativeSessionOfAccount {
  id: string;
  clientId: string;
  isValid: boolean;
  revoked: boolean;
  credentialPurpose: CredentialPurpose;
}

/**
 * Mobile sessions and the access and refresh tokens cut for them. A session's
 * tokens are one family.
 *
 * Every method takes part in an atomic workflow and requires its unit of work.
 * Ids are opaque strings, and one this database could not have issued is
 * `MalformedIdError`.
 *
 * One unit of work per family at a time. Once a write here to a family's
 * session or tokens has returned, no other unit of work can change that family
 * until this one ends. An adapter may take the family earlier, at
 * `findPresentedCredential`. A second unit of work that reaches a taken family
 * is refused at once with a retryable abort. It does not wait.
 */
export abstract class NativeCredentialStore {
  /** The token as presented, whatever its state. The caller judges it. */
  abstract findPresentedCredential(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<StoredNativeCredential | null>;

  abstract findFamilySession(
    unitOfWork: UnitOfWork,
    sessionId: string,
  ): Promise<NativeFamilySession | null>;

  /** Stores a valid, unrevoked mobile session and returns its id. */
  abstract insertNativeSession(
    unitOfWork: UnitOfWork,
    session: NewNativeSession,
  ): Promise<string>;

  /** Stores an unspent access token and an unspent refresh token together. */
  abstract insertCredentialPair(
    unitOfWork: UnitOfWork,
    pair: NewCredentialPair,
  ): Promise<void>;

  /**
   * Ends the session and every token of the family, whatever state they were
   * in. Null when the session is not stored: the tokens are ended all the same.
   */
  abstract revokeFamily(
    unitOfWork: UnitOfWork,
    revocation: FamilyRevocation,
  ): Promise<EndedFamilyOwner | null>;

  /**
   * Stores a proof id until `expiresAt`. An id that is already stored is
   * refused by the database's unique rule: the unit of work ends and leaves its
   * runner as a `UniqueConflictError` named `NATIVE_CONSTRAINT.PROOF_ID`.
   */
  abstract reserveProofId(
    unitOfWork: UnitOfWork,
    proofIdHash: string,
    expiresAt: Date,
  ): Promise<void>;

  abstract findSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<NativeSessionOfAccount | null>;

  /** Ends every token cut for the session. */
  abstract revokeSessionCredentials(
    unitOfWork: UnitOfWork,
    sessionId: string,
    now: Date,
  ): Promise<void>;
}
