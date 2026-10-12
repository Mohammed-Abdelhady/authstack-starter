import { Model } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import {
  HolderMove,
  HolderRevocation,
  MovedHolders,
} from '../../stores/role-records';
import { toObjectIds } from './mongo-role-mappers';

/**
 * The account side of a role change. The bulk update conflicts with any other
 * open transaction that wrote one of the accounts, and MongoDB refuses the
 * later writer at once.
 */
export class MongoRoleHolders {
  constructor(
    private readonly userModel: Model<UserDocument>,
    private readonly events: SecurityEventService,
  ) {}

  async moveHolders(
    unitOfWork: UnitOfWork,
    move: HolderMove,
  ): Promise<MovedHolders> {
    const session = mongoSessionOf(unitOfWork);
    const filter = {
      role: { $in: move.fromSlugs },
      ...(move.holderIds ? { _id: { $in: toObjectIds(move.holderIds) } } : {}),
    };
    const holders = await this.userModel
      .find(filter)
      .select('_id')
      .session(session)
      .lean<{ _id: { toString(): string } }[]>()
      .exec();
    if (holders.length === 0) return { holderIds: [], moved: 0 };
    const affected = await this.userModel
      .updateMany(
        filter,
        { $set: { role: move.toSlug }, $inc: { sessionVersion: 1 } },
        { session },
      )
      .exec();
    return {
      holderIds: holders.map((holder) => holder._id.toString()),
      moved: affected.modifiedCount,
    };
  }

  async appendHolderRevocations(
    unitOfWork: UnitOfWork,
    revocations: HolderRevocation[],
  ): Promise<void> {
    await this.events.recordMany(revocations, mongoSessionOf(unitOfWork));
  }
}
