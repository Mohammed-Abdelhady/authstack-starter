import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../../src/common/persistence/unit-of-work';
import { BrowserIssuanceStore } from '../../../../src/session/issuance/browser-issuance.store';
import { IssuanceApplications } from '../../../../src/session/issuance/issuance-applications';
import { SessionIssuanceService } from '../../../../src/session/services/session-issuance.service';
import { FrozenClock } from '../../frozen-clock';

export const CONTRACT_ENVIRONMENT = 'test';
export const CONTRACT_AUTH_EPOCH = 1;

export interface SeedApplication {
  clientId: string;
  platform: string;
  enabled: boolean;
  sessionVersion: number;
  absoluteLifetimeMs: number;
  idleLifetimeMs: number;
}

export interface StoredAccount {
  issuanceFence: number;
  sessionVersion: number;
}

export interface StoredSession {
  id: string;
  tokenHash: string;
  tokenHashBytes: number;
  csrfToken: string | null;
  clientId: string;
  isValid: boolean;
  revoked: boolean;
  userVersion: number;
  clientVersion: number;
  grantVersion: number;
  deviceName: string | null;
  /** The device label exactly as the database holds it, every stored field. */
  device: unknown;
  authenticatedAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface StoredGrant {
  id: string;
  clientId: string;
  allowed: boolean;
  issuanceFence: number;
}

export interface StoredEvent {
  action: string;
  targetUserId: string | null;
  clientId: string | null;
  sessionId: string | null;
}

export interface LostCommitAnswers {
  commitAttempts: () => number;
  restore: () => void;
}

/**
 * What one database gives the shared contract cases: the adapter under test,
 * the real service built on it, and plain reads and writes of stored state that
 * go around the adapter so a case can check what was really stored.
 */
export interface IssuanceContractHarness {
  readonly clock: FrozenClock;
  readonly store: BrowserIssuanceStore;
  readonly applications: IssuanceApplications;
  /** The adapter's runner, pausing before a rerun the way the case says. */
  runner(pause: RerunPause): UnitOfWorkRunner;
  /** The real sign-in service on this adapter and that runner. */
  service(pause: RerunPause): SessionIssuanceService;

  seedAccount(options?: { deleted?: boolean }): Promise<string>;
  seedApplication(application: SeedApplication): Promise<void>;
  seedBlockedGrant(userId: string, clientId: string): Promise<void>;
  revokeOneSession(userId: string): Promise<void>;
  bumpAccountVersion(userId: string): Promise<void>;

  account(userId: string): Promise<StoredAccount | null>;
  sessions(userId: string): Promise<StoredSession[]>;
  grants(userId: string): Promise<StoredGrant[]>;
  /** Events the cases caused. The row `refuseSecurityEvents` plants is left out. */
  events(): Promise<StoredEvent[]>;

  /** A well-formed id that names no account. */
  absentAccountId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignAccountId(): string;

  /** Until restored, the database refuses every security event as a duplicate. */
  refuseSecurityEvents(): Promise<() => void>;
  /**
   * Loses the answer to the next `times` commits. Left out, it loses every
   * answer until restored: the database cannot be reached to ask again.
   */
  loseCommitAnswers(options: {
    lands: boolean;
    times?: number;
  }): LostCommitAnswers;

  reset(): Promise<void>;
  close(): Promise<void>;
}
