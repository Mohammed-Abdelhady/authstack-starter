import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { ApplicationAccess } from '../../../../src/session/applications/application-access';
import { ApplicationAccessStore } from '../../../../src/session/applications/application-access.store';
import { ApplicationRegistryStore } from '../../../../src/session/applications/application-registry.store';
import { NativeAccessValidator } from '../../../../src/session/native/access/native-access-validator';
import { NativeAuthorizeBrowserService } from '../../../../src/session/native/authorize/native-authorize-browser.service';
import { NativeAuthorizeService } from '../../../../src/session/native/authorize/native-authorize.service';
import { NativeAuthorizationStore } from '../../../../src/session/native/authorize/native-authorization.store';
import { NativeAccessStore } from '../../../../src/session/native/credentials/native-access.store';
import { NativeCredentialStore } from '../../../../src/session/native/credentials/native-credential.store';
import { NativeRotationStore } from '../../../../src/session/native/credentials/native-rotation.store';
import { NativeSecurityEvents } from '../../../../src/session/native/credentials/native-security-events';
import { NativeRefreshRotationService } from '../../../../src/session/native/refresh/native-refresh-rotation.service';
import { NativeBoundRetryService } from '../../../../src/session/native/retry/native-bound-retry.service';
import { NativeTokenService } from '../../../../src/session/native/token/native-token.service';
import { NativeSessionRevocationService } from '../../../../src/session/services/native-session-revocation.service';
import { IssuanceContractHarness } from '../../session/issuance-contract/issuance-contract-harness';

/**
 * Where an adapter takes a token family, or a code, for a unit of work. Both
 * are allowed by the store ports. It decides which of two concurrent units of
 * work is the one refused when the first has only read.
 */
export const TAKEN_AT = {
  FIRST_READ: 'first_read',
  FIRST_WRITE: 'first_write',
} as const;

export type TakenAt = (typeof TAKEN_AT)[keyof typeof TAKEN_AT];

/**
 * What a read inside a unit of work sees of a change another unit of work
 * committed after this one began: nothing, or whatever had committed by the
 * time the statement ran. Both are serial orders of the same two requests.
 */
export const SEES_COMMITS = {
  UNTIL_ITS_START: 'until_its_start',
  UNTIL_EACH_STATEMENT: 'until_each_statement',
} as const;

export type SeesCommits = (typeof SEES_COMMITS)[keyof typeof SEES_COMMITS];

export interface NativeStores {
  authorizations: NativeAuthorizationStore;
  registry: ApplicationRegistryStore;
  grants: ApplicationAccessStore;
  credentials: NativeCredentialStore;
  rotations: NativeRotationStore;
  access: NativeAccessStore;
  events: NativeSecurityEvents;
}

/** The real services, built on one database's stores. */
export interface NativeServices {
  authorize: NativeAuthorizeService;
  browser: NativeAuthorizeBrowserService;
  tokens: NativeTokenService;
  rotation: NativeRefreshRotationService;
  retries: NativeBoundRetryService;
  access: NativeAccessValidator;
  signOut: NativeSessionRevocationService;
  /** Blocking a person and switching an application off, on the same stores. */
  applications: ApplicationAccess;
}

export interface NativeServiceOptions {
  pause?: RerunPause;
  nativeEnabled?: boolean;
  dpopRequired?: boolean;
  authEpoch?: number;
}

export interface NativeApplicationSeed {
  enabled: boolean;
  platform: string;
  clientType: string;
  redirectUris: string[];
  sessionVersion: number;
}

export interface StoredAuthorization {
  id: string;
  consumed: boolean;
  codeHash: string | null;
  expiresAt: Date;
  codeExpiresAt: Date | null;
  userId: string | null;
  state: string;
  requestedScopes: string[];
  authEpoch: number;
  authenticationMethods: string[];
  capturedUserVersion: number | null;
  capturedClientVersion: number | null;
  capturedGrantVersion: number | null;
}

export interface StoredCredential {
  id: string;
  tokenHash: string;
  purpose: string;
  generation: number;
  familyId: string;
  expiresAt: Date;
  spent: boolean;
  consumedAt: Date | null;
  revokedAt: Date | null;
  firstUsedAt: Date | null;
  proofKeyThumbprint: string | null;
  successorAccessHash: string | null;
  successorRefreshHash: string | null;
  retryClaimUntil: Date | null;
}

export interface CredentialPatch {
  expiresAt?: Date;
  consumedAt?: Date;
  retryClaimUntil?: Date;
}

export interface StoredNativeSession {
  isValid: boolean;
  revokedAt: Date | null;
  revokedReason: string | null;
  credentialPurpose: string;
  proofKeyThumbprint: string | null;
  userVersion: number;
  clientVersion: number;
  grantVersion: number;
  scopes: string[];
  authenticationMethods: string[];
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface NativeEvent {
  action: string;
  targetUserId: string | null;
  clientId: string | null;
  sessionId: string | null;
  reasonCode: string | null;
  outcome: string;
}

/**
 * What one database gives the shared cases: the adapters under test, the real
 * services built on them, and plain reads and writes of stored state that go
 * around the adapters so a case can shape and check what is really stored.
 */
export interface NativeContractHarness {
  /** Sign-in on the same database, with its seeding, clock and fault helpers. */
  readonly issuance: IssuanceContractHarness;
  readonly takenAt: TakenAt;
  readonly seesCommits: SeesCommits;
  readonly stores: NativeStores;
  services(options?: NativeServiceOptions): NativeServices;

  seedNativeApplication(patch?: Partial<NativeApplicationSeed>): Promise<void>;
  authorization(transactionId: string): Promise<StoredAuthorization | null>;
  /** A family's tokens, oldest generation first, access before refresh. */
  credentialsOf(sessionId: string): Promise<StoredCredential[]>;
  patchCredential(tokenHash: string, patch: CredentialPatch): Promise<void>;
  session(sessionId: string): Promise<StoredNativeSession | null>;
  revokeSession(sessionId: string): Promise<void>;
  patchGrant(
    userId: string,
    patch: { allowed?: boolean; sessionVersion?: number },
  ): Promise<void>;
  removeGrant(userId: string): Promise<void>;
  markAccountDeleted(userId: string): Promise<void>;
  storedProofIds(): Promise<number>;
  /** Events the cases caused, oldest first. The planted seed row is left out. */
  events(): Promise<NativeEvent[]>;
  /** A well-formed id that names nothing. */
  absentId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignId(): string;
  reset(): Promise<void>;
}
