import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isPersistenceError } from '../../../common/persistence/persistence-errors';
import { Clock } from '../../../common/services/clock';
import {
  SecurityEvent,
  SecurityEventDocument,
} from './schemas/security-event.schema';
import { ROLE_DELETION_EVENT_PREFIX } from '../../constants/security-event-action';
import { RoleDeletionSweep } from '../../types/role-deletion-sweep';
import { LINEARIZABLE_QUERY_MAX_TIME_MS } from '../../../common/persistence/mongo/linearizable-query';
import { RoleAssignmentEvent } from '../../types/role-assignment-event';
import {
  newSecurityEvent,
  RecordSecurityEventInput,
  SecurityEventRecorder,
} from '../../events/security-event-recorder';
import { MongoSecurityEventStore } from './mongo-security-event.store';
import { mongoUnitOfWork } from './mongo-unit-of-work';

export type { RecordSecurityEventInput };

/**
 * The MongoDB face of the event record, for callers that still own a driver
 * transaction. It hands each write to `SecurityEventRecorder` and wraps the
 * caller's session as the unit of work. It goes away when those callers move
 * behind stores.
 */
@Injectable()
export class SecurityEventService {
  private readonly recorder: SecurityEventRecorder;

  constructor(
    @InjectModel(SecurityEvent.name)
    private readonly eventModel: Model<SecurityEventDocument>,
    private readonly clock: Clock,
    @Optional() recorder?: SecurityEventRecorder,
  ) {
    this.recorder =
      recorder ??
      new SecurityEventRecorder(new MongoSecurityEventStore(eventModel), clock);
  }

  async record(
    input: RecordSecurityEventInput,
    session?: ClientSession,
  ): Promise<void> {
    if (session) {
      await this.recorder.record(mongoUnitOfWork(session), input);
      return;
    }
    await asDriverError(this.recorder.recordOutsideUnitOfWork(input));
  }

  /**
   * Record many events in one round trip. A role-wide revocation can touch
   * thousands of holders, and one insert per holder would blow the
   * transaction's lifetime; a single insertMany keeps it bounded.
   */
  async recordMany(
    inputs: RecordSecurityEventInput[],
    session?: ClientSession,
  ): Promise<void> {
    if (session) {
      await this.recorder.recordMany(mongoUnitOfWork(session), inputs);
      return;
    }
    if (inputs.length === 0) {
      return;
    }
    // No store offers this: outside a transaction MongoDB cannot make many
    // inserts all or nothing. Nothing in the server calls it this way.
    const occurredAt = this.clock.now();
    await this.eventModel.insertMany(
      inputs.map((input) => newSecurityEvent(input, occurredAt)),
    );
  }

  async recordRoleDeletion(
    ref: Omit<RoleDeletionSweep, 'pending'>,
    session: ClientSession,
  ): Promise<void> {
    await this.recorder.recordRoleDeletion(mongoUnitOfWork(session), ref);
  }

  async roleDeletionSweep(
    roleId: Types.ObjectId,
    session: ClientSession,
  ): Promise<RoleDeletionSweep | undefined> {
    const event = await this.eventModel
      .findOne({
        eventId: `${ROLE_DELETION_EVENT_PREFIX}${roleId.toString()}`,
      })
      .session(session)
      .exec();
    return event?.roleDeletionSweep;
  }

  async pendingRoleDeletions(limit: number): Promise<RoleDeletionSweep[]> {
    const events = await this.eventModel
      .find({
        eventId: { $regex: `^${ROLE_DELETION_EVENT_PREFIX}` },
        'roleDeletionSweep.pending': true,
      })
      .limit(limit)
      .maxTimeMS(LINEARIZABLE_QUERY_MAX_TIME_MS)
      .lean()
      .exec();
    return events.flatMap((event) =>
      event.roleDeletionSweep ? [event.roleDeletionSweep] : [],
    );
  }

  async completeRoleDeletionSweep(roleId: Types.ObjectId): Promise<void> {
    await this.eventModel
      .updateOne(
        {
          eventId: `${ROLE_DELETION_EVENT_PREFIX}${roleId.toString()}`,
          'roleDeletionSweep.pending': true,
        },
        { $set: { 'roleDeletionSweep.pending': false } },
      )
      .exec();
  }

  /** Read each holder's assignment history using the existing target-user index. */
  async previousRoleIdsForAssignment(
    userIds: Types.ObjectId[],
    assignedRoleId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Map<string, Types.ObjectId>> {
    const history = await this.eventModel
      .aggregate<{ _id: string; assignment: RoleAssignmentEvent }>([
        {
          $match: {
            targetUserId: { $in: userIds.map((id) => id.toString()) },
            roleAssignment: { $exists: true },
          },
        },
        { $sort: { 'roleAssignment.sessionVersion': -1, _id: -1 } },
        {
          $group: {
            _id: '$targetUserId',
            assignment: { $first: '$roleAssignment' },
          },
        },
      ])
      .session(session)
      .exec();
    const previous = new Map<string, Types.ObjectId>();
    for (const event of history) {
      if (event.assignment.assignedRoleId !== assignedRoleId.toString())
        continue;
      const roleId = event.assignment.previousRoleId;
      if (roleId && Types.ObjectId.isValid(roleId)) {
        previous.set(event._id, new Types.ObjectId(roleId));
      }
    }
    return previous;
  }
}

/** Callers of this class still read the driver's own error. */
async function asDriverError(write: Promise<void>): Promise<void> {
  try {
    await write;
  } catch (error) {
    throw isPersistenceError(error) && error.cause !== undefined
      ? error.cause
      : error;
  }
}
