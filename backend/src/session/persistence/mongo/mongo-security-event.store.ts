import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  insertOrConflict,
  singleStatement,
} from '../../../common/persistence/mongo/mongo-unique-conflict';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  NewSecurityEvent,
  SECURITY_EVENT_CONSTRAINT,
  SecurityEventStore,
  StoredSecurityEvent,
} from '../../events/security-event.store';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { mongoSessionOf } from './mongo-unit-of-work';

const EVENT_CONSTRAINTS = {
  eventId_1: SECURITY_EVENT_CONSTRAINT.EVENT_ID,
} as const;

function toStoredEvent(event: SecurityEvent): StoredSecurityEvent {
  return {
    eventId: event.eventId,
    actorId: event.actorId ?? null,
    targetUserId: event.targetUserId ?? null,
    clientId: event.clientId ?? null,
    sessionId: event.sessionId ?? null,
    action: event.action,
    reasonCode: event.reasonCode ?? null,
    requestId: event.requestId ?? null,
    outcome: event.outcome,
    occurredAt: event.occurredAt,
    roleAssignment: event.roleAssignment ?? null,
    roleDeletionSweep: event.roleDeletionSweep ?? null,
  };
}

/**
 * Inside a unit of work the driver's own error leaves as raised: the runner
 * that owns the transaction maps it, and reads its labels to decide a rerun.
 * Retention is the schema's `purgeAfter` default, removed by the TTL index.
 */
@Injectable()
export class MongoSecurityEventStore extends SecurityEventStore {
  constructor(
    @InjectModel(SecurityEvent.name)
    private readonly eventModel: Model<SecurityEventDocument>,
  ) {
    super();
  }

  async append(unitOfWork: UnitOfWork, event: NewSecurityEvent): Promise<void> {
    await this.eventModel.create([event], {
      session: mongoSessionOf(unitOfWork),
    });
  }

  async appendMany(
    unitOfWork: UnitOfWork,
    events: NewSecurityEvent[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.eventModel.insertMany(events, {
      session: mongoSessionOf(unitOfWork),
    });
  }

  async appendOutsideUnitOfWork(event: NewSecurityEvent): Promise<void> {
    await insertOrConflict(EVENT_CONSTRAINTS, () =>
      this.eventModel.create([event], undefined),
    );
  }

  async listRecentForUser(
    userId: string,
    limit: number,
  ): Promise<StoredSecurityEvent[]> {
    if (limit < 1) {
      return [];
    }
    const events = await singleStatement(() =>
      this.eventModel
        .find({ targetUserId: userId })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(limit)
        .lean<SecurityEvent[]>()
        .exec(),
    );
    return events.map(toStoredEvent);
  }
}
