import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type {
  IdempotencyClaim,
  IdempotencyClaimInput,
  IdempotencyScope,
} from '../types/staff-idempotency';

/**
 * Idempotency keys of staff creates. The key is claimed first in the create's
 * own unit of work and completed with what the create made, so the record
 * commits with the create or not at all. A second claim of a live key waits
 * for the first unit of work, or is refused with a retryable abort and runs
 * again, and then reports the committed record. An expired record is taken
 * over as if absent.
 */
export abstract class StaffIdempotencyStore {
  abstract claim(
    unitOfWork: UnitOfWork,
    input: IdempotencyClaimInput,
  ): Promise<IdempotencyClaim>;

  abstract complete(
    unitOfWork: UnitOfWork,
    scope: IdempotencyScope,
    resourceId: string,
  ): Promise<void>;
}
