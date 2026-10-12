import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { toObjectId } from '../../../session/persistence/mongo/mongo-issuance-mappers';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { LINEARIZABLE_QUERY_MAX_TIME_MS } from '../../../common/persistence/mongo/linearizable-query';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { Role, RoleDocument } from './schemas/role.schema';
import {
  PendingSweep,
  RoleDeletionRecord,
  StrandedHolder,
  SweepOwner,
} from '../../stores/role-records';
import { RoleSweepStore } from '../../stores/role-sweep.store';
import {
  toObjectIds,
  toPendingRoleSweep,
  toSweepOwner,
} from './mongo-role-mappers';

interface LeanHolder {
  _id: { toString(): string };
  role: string;
}

function toStrandedHolder(holder: LeanHolder): StrandedHolder {
  return { id: holder._id.toString(), role: holder.role };
}

/**
 * Fences a destination by writing its role document, which conflicts with any
 * open transaction that edits the role.
 */
@Injectable()
export class MongoRoleSweepStore extends RoleSweepStore {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly events: SecurityEventService,
  ) {
    super();
  }

  async listStrandedHolders(
    unitOfWork: UnitOfWork,
    sources: string[],
  ): Promise<StrandedHolder[]> {
    const session = mongoSessionOf(unitOfWork);
    const live = await this.roleModel
      .find({ slug: { $in: sources } })
      .select('slug')
      .session(session)
      .lean()
      .exec();
    const stale = await this.userModel
      .find({
        role: { $in: sources, $nin: live.map((role) => role.slug) },
      })
      .select('_id role')
      .session(session)
      .lean<LeanHolder[]>()
      .exec();
    return stale.map(toStrandedHolder);
  }

  async readDeletionRecord(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<RoleDeletionRecord | null> {
    const deletion = await this.events.roleDeletionSweep(
      toObjectId(roleId),
      mongoSessionOf(unitOfWork),
    );
    return deletion ?? null;
  }

  async findPendingSweepActor(
    unitOfWork: UnitOfWork,
    roleId: string,
    previousSlug: string,
  ): Promise<string | null> {
    const id = toObjectId(roleId);
    const owner = await this.roleModel
      .findOne({
        pendingHolderSweeps: { $elemMatch: { roleId: id, previousSlug } },
      })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    const owed = owner?.pendingHolderSweeps.find(
      (ref) => ref.roleId.equals(id) && ref.previousSlug === previousSlug,
    );
    return owed?.actorId ?? null;
  }

  async readPreviousRoles(
    unitOfWork: UnitOfWork,
    holderIds: string[],
    assignedRoleId: string,
  ): Promise<Map<string, string>> {
    const previous = await this.events.previousRoleIdsForAssignment(
      toObjectIds(holderIds),
      toObjectId(assignedRoleId),
      mongoSessionOf(unitOfWork),
    );
    const roles = new Map<string, string>();
    for (const [holderId, roleId] of previous) {
      roles.set(holderId, roleId.toString());
    }
    return roles;
  }

  async fenceDestination(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<void> {
    await this.roleModel
      .updateOne(
        { _id: toObjectId(roleId) },
        { $inc: { __v: 1 } },
        { session: mongoSessionOf(unitOfWork), timestamps: false },
      )
      .exec();
  }

  async listStrandedHoldersCommitted(
    sources: string[],
  ): Promise<StrandedHolder[]> {
    const live = await this.roleModel
      .find({ slug: { $in: sources } })
      .select('slug')
      .lean()
      .exec();
    const remaining = await this.userModel
      .find({
        role: { $in: sources, $nin: live.map((role) => role.slug) },
      })
      .select('_id role')
      .lean<LeanHolder[]>()
      .exec();
    return remaining.map(toStrandedHolder);
  }

  async clearPendingSweep(
    ownerRoleId: string,
    sweep: PendingSweep,
  ): Promise<void> {
    await this.roleModel
      .updateOne(
        { _id: toObjectId(ownerRoleId) },
        {
          $pull: {
            pendingHolderSweeps: {
              roleId: toObjectId(sweep.roleId),
              previousSlug: sweep.previousSlug,
              actorId: sweep.actorId,
              sweepId: sweep.sweepId ?? { $exists: false },
            },
          },
        },
      )
      .exec();
  }

  async recordPendingSweepIfRoom(
    ownerRoleId: string,
    sweep: PendingSweep,
    limit: number,
  ): Promise<void> {
    await this.roleModel
      .updateOne(
        {
          _id: toObjectId(ownerRoleId),
          pendingHolderSweeps: {
            $not: {
              $elemMatch: {
                roleId: toObjectId(sweep.roleId),
                previousSlug: sweep.previousSlug,
              },
            },
          },
          $expr: {
            $lt: [{ $size: { $ifNull: ['$pendingHolderSweeps', []] } }, limit],
          },
        },
        { $push: { pendingHolderSweeps: toPendingRoleSweep(sweep) } },
      )
      .exec();
  }

  async completeDeletion(roleId: string): Promise<void> {
    await this.events.completeRoleDeletionSweep(toObjectId(roleId));
  }

  async listSweepOwners(limit: number): Promise<SweepOwner[]> {
    const owners = await this.roleModel
      .find({ 'pendingHolderSweeps.0': { $exists: true } })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit)
      .maxTimeMS(LINEARIZABLE_QUERY_MAX_TIME_MS)
      .exec();
    return owners.map(toSweepOwner);
  }

  async findSweepOwnerBySlug(slug: string): Promise<SweepOwner | null> {
    const role = await this.roleModel.findOne({ slug }).exec();
    return role ? toSweepOwner(role) : null;
  }

  async rotateSweepOwner(ownerRoleId: string, at: Date): Promise<void> {
    await this.roleModel.updateOne(
      {
        _id: toObjectId(ownerRoleId),
        'pendingHolderSweeps.0': { $exists: true },
      },
      { $set: { updatedAt: at } },
      { timestamps: false },
    );
  }

  async listPendingDeletions(limit: number): Promise<PendingSweep[]> {
    const deletions = await this.events.pendingRoleDeletions(limit);
    return deletions.map((deletion) => ({
      roleId: deletion.roleId,
      previousSlug: deletion.previousSlug,
      actorId: deletion.actorId,
      ...(deletion.sweepId === undefined ? {} : { sweepId: deletion.sweepId }),
    }));
  }
}
