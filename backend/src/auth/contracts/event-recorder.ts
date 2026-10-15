import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { RecordSecurityEventInput } from '../../session/events/security-event-recorder';
import type { RoleDeletionSweep } from '../../session/types/role-deletion-sweep';

/** Defaults to today's persisted SecurityEventRecorder API; plan 4 adds typed event details. */
export abstract class EventRecorder {
  abstract record(
    unitOfWork: UnitOfWork,
    input: RecordSecurityEventInput,
  ): Promise<void>;
  abstract recordMany(
    unitOfWork: UnitOfWork,
    inputs: RecordSecurityEventInput[],
  ): Promise<void>;
  abstract recordRoleDeletion(
    unitOfWork: UnitOfWork,
    ref: Omit<RoleDeletionSweep, 'pending'>,
  ): Promise<void>;
  abstract recordOutsideUnitOfWork(
    input: RecordSecurityEventInput,
  ): Promise<void>;
}
