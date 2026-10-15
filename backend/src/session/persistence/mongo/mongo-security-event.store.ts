import { ACTIVITY_RETENTION_DAYS_DEFAULT } from '../../../config/constants/host-contracts';
import { ConfigService } from '@nestjs/config';
import { eventActivityFields } from '../../events/utils/activity-details';
import { activityQuery } from '../../events/utils/activity-query';
import { ActivityQuery } from '../../events/types/activity-event';
import {
  ACTIVITY_DAY_MS,
  SIGN_IN_RETENTION_DAYS,
} from '../../events/constants/activity-details';
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
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
    kind: event.kind ?? 'sign_in',
    details: event.details ?? {},
    purgeAfter: event.purgeAfter,
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

function persistedEvent(event: NewSecurityEvent, retentionDays: number) {
  const activity = eventActivityFields(event, true);
  const days =
    activity.kind === 'staff' ? retentionDays : SIGN_IN_RETENTION_DAYS;
  return {
    ...event,
    ...activity,
    purgeAfter:
      event.purgeAfter ??
      new Date(event.occurredAt.getTime() + days * ACTIVITY_DAY_MS),
  };
}

/**
 * Inside a unit of work the driver's own error leaves as raised: the runner
 * that owns the transaction maps it, and reads its labels to decide a rerun.
 * Retention is fixed on each write and enforced by the TTL index.
 */
@Injectable()
export class MongoSecurityEventStore extends SecurityEventStore {
  constructor(
    @InjectModel(SecurityEvent.name)
    private readonly eventModel: Model<SecurityEventDocument>,
    @Optional() private readonly config?: ConfigService,
  ) {
    super();
  }

  private event(event: NewSecurityEvent) {
    return persistedEvent(
      event,
      this.config?.get<number>('activity.retentionDays') ??
        ACTIVITY_RETENTION_DAYS_DEFAULT,
    );
  }

  async append(unitOfWork: UnitOfWork, event: NewSecurityEvent): Promise<void> {
    await this.eventModel.create([this.event(event)], {
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
    await this.eventModel.insertMany(
      events.map((event) => this.event(event)),
      {
        session: mongoSessionOf(unitOfWork),
      },
    );
  }

  async appendOutsideUnitOfWork(event: NewSecurityEvent): Promise<void> {
    await insertOrConflict(EVENT_CONSTRAINTS, () =>
      this.eventModel.create([this.event(event)], undefined),
    );
  }

  async listActivity(input: ActivityQuery, now: Date) {
    const query = activityQuery(input);
    const matching: FilterQuery<SecurityEvent> = {
      kind: 'staff',
      purgeAfter: { $gt: now },
    };
    if (query.actor) matching.actorId = query.actor;
    if (query.action) matching.action = query.action;
    if (query.target) matching.targetUserId = query.target;
    if (query.from || query.to) {
      matching.occurredAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lt: query.to } : {}),
      };
    }
    return singleStatement(async () => {
      const session = await this.eventModel.db.startSession();
      try {
        return await session.withTransaction(
          async () => {
            const total = await this.eventModel
              .countDocuments(matching)
              .session(session)
              .exec();
            const rows = await this.eventModel
              .find(matching)
              .session(session)
              .sort({ occurredAt: -1, _id: -1 })
              .skip((query.page - 1) * query.limit)
              .limit(query.limit)
              .lean<SecurityEvent[]>()
              .exec();
            return { data: rows.map(toStoredEvent), total };
          },
          { readConcern: { level: 'snapshot' } },
        );
      } finally {
        await session.endSession();
      }
    });
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
