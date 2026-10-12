import { IdFormat } from '../../../../src/common/persistence/id-format';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { AuthorityApplications } from '../../../../src/session/authority/authority-applications';
import { SessionAuthorityStore } from '../../../../src/session/authority/session-authority.store';
import { SessionValidator } from '../../../../src/session/authority/session-validator';
import { SessionRevocationStore } from '../../../../src/session/revocation/session-revocation.store';
import { SessionRevoker } from '../../../../src/session/revocation/session-revoker';
import { IssuanceContractHarness } from '../issuance-contract/issuance-contract-harness';

/**
 * Where an adapter takes the account for a unit of work. Both are allowed by
 * the store ports. It decides which of two concurrent units of work is the one
 * refused when the first has only read the account.
 */
export const ACCOUNT_TAKEN_AT = {
  FIRST_READ: 'first_read',
  FIRST_WRITE: 'first_write',
} as const;

export type AccountTakenAt =
  (typeof ACCOUNT_TAKEN_AT)[keyof typeof ACCOUNT_TAKEN_AT];

export interface SessionState {
  isValid: boolean;
  revokedAt: Date | null;
  revokedReason: string | null;
  userVersion: number;
  idleExpiresAt: Date;
  lastActivityAt: Date;
  lastUsedAt: Date | null;
}

export interface SessionPatch {
  credentialPurpose?: string;
  authEpoch?: number;
  schemaVersion?: number;
  userVersion?: number;
  clientVersion?: number;
  grantVersion?: number;
  expiresAt?: Date;
  idleExpiresAt?: Date;
  lastActivityAt?: Date;
  lastUsedAt?: Date;
}

export interface GrantPatch {
  allowed?: boolean;
  sessionVersion?: number;
}

export interface AccountIdentitySeed {
  email: string;
  name: string;
  role: string;
  permissions: string[];
  verified: boolean;
}

export interface RecordedEvent {
  action: string;
  actorId: string | null;
  targetUserId: string | null;
  clientId: string | null;
  sessionId: string | null;
  reasonCode: string | null;
}

/**
 * What one database gives the shared cases: the adapters under test, the real
 * services built on them, and plain reads and writes of stored state that go
 * around the adapters so a case can shape and check what is really stored.
 */
export interface AuthorityContractHarness {
  /** Sign-in on the same database, with its seeding, clock and fault helpers. */
  readonly issuance: IssuanceContractHarness;
  readonly accountTakenAt: AccountTakenAt;
  readonly authorityStore: SessionAuthorityStore;
  readonly authorityApplications: AuthorityApplications;
  readonly revocationStore: SessionRevocationStore;
  /** What this database takes as an id, as a route asks it. */
  readonly ids: IdFormat;
  validator(): SessionValidator;
  /** The real revocation service on this adapter, pausing as the case says. */
  revoker(pause: RerunPause): SessionRevoker;
  session(sessionId: string): Promise<SessionState | null>;
  patchSession(sessionId: string, patch: SessionPatch): Promise<void>;
  patchGrant(
    userId: string,
    clientId: string,
    patch: GrantPatch,
  ): Promise<void>;
  removeGrant(userId: string, clientId: string): Promise<void>;
  markAccountDeleted(userId: string): Promise<void>;
  /** Stores who an account is, committed, around the adapters. */
  setAccountIdentity(
    userId: string,
    identity: AccountIdentitySeed,
  ): Promise<void>;
  /** Events the cases caused, oldest first. The planted seed row is left out. */
  events(): Promise<RecordedEvent[]>;
  /** A well-formed id that names no session. */
  absentSessionId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignSessionId(): string;
}
