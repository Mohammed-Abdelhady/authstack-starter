import { SessionProofStore } from '../../../src/auth/proof/stores/session-proof.store';
import { ProofSessionRef } from '../../../src/auth/proof/types/session-proof';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { FrozenClock } from '../frozen-clock';

export interface SessionProofHarness {
  readonly store: SessionProofStore;
  readonly clock: FrozenClock;
  runner(): UnitOfWorkRunner;
  seedSession(userId?: string): Promise<ProofSessionRef>;
  purgeAfter(ref: ProofSessionRef): Promise<Date | null>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export type SessionProofHarnessSource = () => SessionProofHarness;
