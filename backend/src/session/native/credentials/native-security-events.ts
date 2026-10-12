import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RecordSecurityEventInput } from '../../events/security-event-recorder';

/**
 * The event record as mobile sign-in writes to it. An event that belongs to an
 * atomic workflow takes that workflow's unit of work and commits or rolls back
 * with it.
 */
export abstract class NativeSecurityEvents {
  abstract record(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void>;

  /** For a refusal recorded outside any atomic workflow. Commits by itself. */
  abstract recordOutsideUnitOfWork(
    event: RecordSecurityEventInput,
  ): Promise<void>;
}
