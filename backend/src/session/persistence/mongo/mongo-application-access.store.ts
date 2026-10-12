import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  AccessGrant,
  APPLICATION_SWITCH,
  ApplicationAccessStore,
  ApplicationSwitch,
  NewBlockedGrant,
} from '../../applications/application-access.store';
import { RecordSecurityEventInput } from '../../events/security-event-recorder';
import { Application, ApplicationDocument } from './schemas/application.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantDocument,
} from './schemas/user-application-grant.schema';
import { SecurityEventService } from './security-event.service';
import { toObjectId } from './mongo-issuance-mappers';
import { isStorableId } from './mongo-session-records';
import { mongoSessionOf } from './mongo-unit-of-work';

function toAccessGrant(grant: {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  clientId: string;
  allowed?: boolean;
  sessionVersion?: number;
}): AccessGrant {
  return {
    id: grant._id.toString(),
    userId: grant.userId.toString(),
    clientId: grant.clientId,
    allowed: Boolean(grant.allowed),
    sessionVersion: grant.sessionVersion ?? 0,
  };
}

/**
 * Takes the account's grants at the write that creates or blocks one: it
 * conflicts with any other open transaction that wrote the same grant, and
 * MongoDB refuses the later writer at once.
 *
 * The driver's own error leaves as raised: the runner that owns the transaction
 * maps it, and reads its labels to decide a rerun.
 */
@Injectable()
export class MongoApplicationAccessStore extends ApplicationAccessStore {
  constructor(
    @InjectModel(Application.name)
    private readonly applicationModel: Model<ApplicationDocument>,
    @InjectModel(UserApplicationGrant.name)
    private readonly grantModel: Model<UserApplicationGrantDocument>,
    private readonly events: SecurityEventService,
  ) {
    super();
  }

  async readGrant(
    userId: string,
    clientId: string,
  ): Promise<AccessGrant | null> {
    // Mongoose decides what an id is here, as it did before this read moved.
    if (!isStorableId(userId)) {
      throw new MalformedIdError();
    }
    const grant = await singleStatement(() =>
      this.grantModel.findOne({ userId, clientId }).exec(),
    );
    return grant ? toAccessGrant(grant) : null;
  }

  async takeGrantForChange(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<AccessGrant | null> {
    const grant = await this.grantModel
      .findOne({ userId: toObjectId(userId), clientId })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return grant ? toAccessGrant(grant) : null;
  }

  async createBlockedGrant(
    unitOfWork: UnitOfWork,
    grant: NewBlockedGrant,
  ): Promise<AccessGrant> {
    const [created] = await this.grantModel.create(
      [
        {
          userId: toObjectId(grant.userId),
          clientId: grant.clientId,
          allowed: false,
          sessionVersion: grant.sessionVersion,
          issuanceFence: 0,
        },
      ],
      { session: mongoSessionOf(unitOfWork) },
    );
    return toAccessGrant(created);
  }

  async blockGrant(unitOfWork: UnitOfWork, grantId: string): Promise<void> {
    await this.grantModel
      .updateOne(
        { _id: toObjectId(grantId) },
        { $set: { allowed: false }, $inc: { sessionVersion: 1 } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  disableApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<ApplicationSwitch> {
    return this.switchApplication(unitOfWork, environment, clientId, {
      $set: { enabled: false },
      $inc: { sessionVersion: 1 },
    });
  }

  enableApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<ApplicationSwitch> {
    return this.switchApplication(unitOfWork, environment, clientId, {
      $set: { enabled: true },
    });
  }

  async appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void> {
    await this.events.record(event, mongoSessionOf(unitOfWork));
  }

  private async switchApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
    update: { $set: { enabled: boolean }; $inc?: { sessionVersion: number } },
  ): Promise<ApplicationSwitch> {
    const result = await this.applicationModel
      .updateOne({ clientId, environment }, update)
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return result.matchedCount === 1
      ? APPLICATION_SWITCH.SWITCHED
      : APPLICATION_SWITCH.NOT_REGISTERED;
  }
}
