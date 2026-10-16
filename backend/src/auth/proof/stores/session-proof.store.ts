import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { FreshProofAct } from '../../contracts/types/fresh-proof';
import type {
  OpenProofChallenge,
  ProofKind,
  ProofSessionRef,
  RecordedProof,
  StoredProofChallenge,
} from '../types/session-proof';

/**
 * One row per session: the challenge it waits on, and the last proof it
 * made. The row ends with its session. A read matches the session, the
 * account and the application together, so a proof never crosses sessions.
 */
export abstract class SessionProofStore {
  /** Replaces any open challenge of the session. A recorded proof stays. */
  abstract openChallenge(
    unitOfWork: UnitOfWork,
    challenge: OpenProofChallenge,
  ): Promise<void>;

  /** The open challenge of this kind, locked until the unit of work ends. */
  abstract takeChallenge(
    unitOfWork: UnitOfWork,
    ref: ProofSessionRef,
    kind: ProofKind,
  ): Promise<StoredProofChallenge | null>;

  /** Counts a wrong answer. At `limit` the challenge is cleared. Returns the count. */
  abstract recordWrongGuess(
    unitOfWork: UnitOfWork,
    ref: ProofSessionRef,
    limit: number,
  ): Promise<number>;

  /** Clears the open challenge and records the proof it gave. */
  abstract recordProof(
    unitOfWork: UnitOfWork,
    proof: RecordedProof,
  ): Promise<void>;

  /** The last proof the session made, or null. */
  abstract readProof(
    unitOfWork: UnitOfWork,
    ref: ProofSessionRef,
  ): Promise<FreshProofAct | null>;
}
