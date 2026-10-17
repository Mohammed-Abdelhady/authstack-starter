import { Injectable } from '@nestjs/common';
import { EMAIL_CHANGE_INITIATOR } from '../../../auth/constants/email-change-initiator';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  AdminRosterStore,
  AdminSignInRule,
} from '../../stores/admin-roster.store';
import {
  AdminRosterLock,
  AdminRosterLockDocument,
} from './admin-roster-lock.schema';

const ADMIN_ROSTER_LOCK = 'admin-roster';
const ADMIN_ROLE = 'admin';

@Injectable()
export class MongoAdminRosterStore extends AdminRosterStore {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(AdminRosterLock.name)
    private readonly locks: Model<AdminRosterLockDocument>,
  ) {
    super();
  }

  async lock(unitOfWork: UnitOfWork): Promise<void> {
    await this.locks
      .findOneAndUpdate(
        { _id: ADMIN_ROSTER_LOCK },
        { $inc: { lockVersion: 1 } },
        { upsert: true, session: mongoSessionOf(unitOfWork) },
      )
      .exec();
  }

  async countAdminsWhoCanSignIn(
    unitOfWork: UnitOfWork,
    rule: AdminSignInRule,
  ): Promise<number> {
    const session = mongoSessionOf(unitOfWork);
    const filter = {
      role: ADMIN_ROLE,
      isDeleted: { $ne: true },
      _id: {
        $nin: rule.excluding
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      },
    };
    // feature:passkeys:start
    if (rule.passkeyRelyingParty) {
      const { rpId, includesUnmarked } = rule.passkeyRelyingParty;
      const relyingParty = includesUnmarked
        ? { $or: [{ rpId }, { rpId: null }] }
        : { rpId };
      const rows = await this.users
        .aggregate<{ count: number }>([
          { $match: filter },
          {
            $lookup: {
              from: 'passkeys',
              let: { userId: '$_id' },
              pipeline: [
                {
                  $match: {
                    ...relyingParty,
                    $expr: { $eq: ['$user', '$$userId'] },
                  },
                },
                { $limit: 1 },
              ],
              as: 'eligiblePasskeys',
            },
          },
          { $match: { 'eligiblePasskeys.0': { $exists: true } } },
          { $count: 'count' },
        ])
        .session(session)
        .exec();
      return rows[0]?.count ?? 0;
    }
    // feature:passkeys:end
    return this.users
      .countDocuments({
        ...filter,
        isVerified: true,
        $or: [
          { pendingEmail: null },
          { pendingEmailInitiator: EMAIL_CHANGE_INITIATOR.SELF },
        ],
      })
      .session(session)
      .exec();
  }

  async hasActiveAdministrator(unitOfWork: UnitOfWork): Promise<boolean> {
    const row = await this.users
      .findOne({
        role: ADMIN_ROLE,
        isDeleted: { $ne: true },
      })
      .select('_id')
      .session(mongoSessionOf(unitOfWork))
      .lean()
      .exec();
    return row !== null;
  }
}
