import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { FRESH_PROOF_REQUIREMENT } from '../contracts/constants/fresh-proof';
import type { ActingSession } from './types/acting-session';

export type FreshProofRequirement =
  (typeof FRESH_PROOF_REQUIREMENT)[keyof typeof FRESH_PROOF_REQUIREMENT];

/**
 * Whether the acting session holds a fresh enough proof. It reads the
 * session's recorded proof and its application's passkey policy inside the
 * caller's unit of work and asks `FreshProofCheck`.
 */
export abstract class FreshProofGate {
  /**
   * @throws AppException REAUTH_REQUIRED (401) with `details.required` set to
   * `fresh_proof` and `details.methods` naming what would satisfy it
   */
  abstract assertFresh(
    unitOfWork: UnitOfWork,
    session: ActingSession,
    requirement: FreshProofRequirement,
  ): Promise<void>;
}
