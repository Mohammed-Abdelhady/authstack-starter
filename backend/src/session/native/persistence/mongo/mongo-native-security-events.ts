import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { RecordSecurityEventInput } from '../../../events/security-event-recorder';
import { mongoSessionOf } from '../../../persistence/mongo/mongo-unit-of-work';
import { SecurityEventService } from '../../../persistence/mongo/security-event.service';
import { NativeSecurityEvents } from '../../credentials/native-security-events';

/** Hands each event to the service that still owns the MongoDB event record. */
@Injectable()
export class MongoNativeSecurityEvents extends NativeSecurityEvents {
  constructor(private readonly events: SecurityEventService) {
    super();
  }

  async record(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void> {
    await this.events.record(event, mongoSessionOf(unitOfWork));
  }

  async recordOutsideUnitOfWork(
    event: RecordSecurityEventInput,
  ): Promise<void> {
    await this.events.record(event);
  }
}
