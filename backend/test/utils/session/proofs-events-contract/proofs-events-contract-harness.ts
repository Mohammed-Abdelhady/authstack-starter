import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../../src/common/persistence/unit-of-work';
import { SecurityEventRecorder } from '../../../../src/session/events/security-event-recorder';
import { SecurityEventStore } from '../../../../src/session/events/security-event.store';
import { BrowserProofStore } from '../../../../src/session/proofs/browser-proof.store';
import { BrowserProofService } from '../../../../src/session/services/browser-proof.service';
import { FrozenClock } from '../../frozen-clock';

export interface StoredProof {
  tokenHash: string;
  expiresAt: Date;
  spent: boolean;
}

export interface SeedProof extends StoredProof {
  proofIdHash: string;
}

export interface SeedEvent {
  eventId: string;
  targetUserId?: string;
  action: string;
  occurredAt: Date;
  /** When the database's cleanup may remove the row. */
  purgeAfter: Date;
}

/**
 * What one database gives the shared cases: the two adapters under test, the
 * real services built on them, and plain reads and writes of stored rows that
 * go around the adapters so a case can check what was really stored.
 */
export interface ProofsEventsContractHarness {
  readonly clock: FrozenClock;
  readonly proofs: BrowserProofStore;
  readonly events: SecurityEventStore;
  readonly proofService: BrowserProofService;
  readonly recorder: SecurityEventRecorder;
  /** The adapter's runner, pausing before a rerun the way the case says. */
  runner(pause: RerunPause): UnitOfWorkRunner;

  seedProof(proof: SeedProof): Promise<void>;
  storedProof(proofIdHash: string): Promise<StoredProof | null>;
  proofCount(): Promise<number>;

  seedEvent(event: SeedEvent): Promise<void>;
  /** Ids of every stored event, sorted. */
  storedEventIds(): Promise<string[]>;

  /** An account id in this database's own form. */
  ownAccountId(): string;
  /** An account id in the other database's form. */
  foreignAccountId(): string;

  reset(): Promise<void>;
  close(): Promise<void>;
}
