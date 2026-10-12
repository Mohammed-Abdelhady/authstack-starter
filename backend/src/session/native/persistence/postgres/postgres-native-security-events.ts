import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import {
  RecordSecurityEventInput,
  SecurityEventRecorder,
} from '../../../events/security-event-recorder';
import { NativeSecurityEvents } from '../../credentials/native-security-events';

/** Writes through the recorder every converted workflow uses. */
export class PostgresNativeSecurityEvents extends NativeSecurityEvents {
  constructor(private readonly recorder: SecurityEventRecorder) {
    super();
  }

  record(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void> {
    return this.recorder.record(unitOfWork, event);
  }

  recordOutsideUnitOfWork(event: RecordSecurityEventInput): Promise<void> {
    return this.recorder.recordOutsideUnitOfWork(event);
  }
}
