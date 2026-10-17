import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RetryableAbortError } from '../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { RoleAudience } from '../../../host/types/host-role.type';
import {
  Role,
  RoleDocument,
} from '../../../role/persistence/mongo/schemas/role.schema';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { AudienceMappingStore } from '../../stores/audience-mapping.store';
import type {
  AudienceMappingAccount,
  AudienceMappingRole,
  AudienceMappingSnapshot,
  AudienceSnapshotOptions,
  MissingAudienceCounts,
} from '../../types/audience-mapping';
import { User, UserDocument } from './schemas/user.schema';

class AudienceMappingRetry extends RetryableAbortError {
  readonly errorLabels = ['TransientTransactionError'];
}

@Injectable()
export class MongoAudienceMappingStore extends AudienceMappingStore {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
  ) {
    super();
  }

  async missingCounts(work: UnitOfWork): Promise<MissingAudienceCounts> {
    const session = mongoSessionOf(work);
    const roles = await this.roles
      .countDocuments({ audience: null })
      .session(session);
    const accounts = await this.users
      .countDocuments({ audience: null })
      .session(session);
    return { roles, accounts };
  }

  async snapshot(
    work: UnitOfWork,
    _options?: AudienceSnapshotOptions,
  ): Promise<AudienceMappingSnapshot> {
    const session = mongoSessionOf(work);
    const roles = await this.roles
      .find({})
      .select('slug audience permissions')
      .sort({ _id: 1 })
      .session(session)
      .lean()
      .exec();
    const accounts = await this.users
      .find({})
      .select('role audience permissions')
      .sort({ _id: 1 })
      .session(session)
      .lean()
      .exec();
    return {
      roles: roles.map((role) => ({
        id: role._id.toString(),
        slug: role.slug,
        permissions: role.permissions ?? [],
        ...(role.audience == null ? {} : { audience: role.audience }),
      })),
      accounts: accounts.map((account) => ({
        id: account._id.toString(),
        role: account.role,
        permissions: account.permissions ?? [],
        ...(account.audience == null ? {} : { audience: account.audience }),
      })),
    };
  }

  async mapRole(
    work: UnitOfWork,
    role: AudienceMappingRole,
    audience: RoleAudience,
  ): Promise<void> {
    // This missing-only operator write is the sole bypass of role immutability.
    const changed = await this.roles.collection.updateOne(
      { _id: new Types.ObjectId(role.id), slug: role.slug, audience: null },
      { $set: { audience }, $currentDate: { updatedAt: true } },
      { session: mongoSessionOf(work) },
    );
    if (changed.matchedCount !== 1) throw new AudienceMappingRetry();
  }

  async mapAccount(
    work: UnitOfWork,
    account: AudienceMappingAccount,
    audience: RoleAudience,
  ): Promise<void> {
    const changed = await this.users
      .updateOne(
        {
          _id: new Types.ObjectId(account.id),
          role: account.role,
          audience: null,
        },
        { $set: { audience } },
        { session: mongoSessionOf(work) },
      )
      .exec();
    if (changed.matchedCount !== 1) throw new AudienceMappingRetry();
  }
}
