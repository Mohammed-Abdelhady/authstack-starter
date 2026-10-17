import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Error as MongooseError, Model } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { toObjectId } from '../../../session/persistence/mongo/mongo-issuance-mappers';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { Role, RoleDocument } from './schemas/role.schema';
import { RoleChangeStore } from '../../stores/role-change.store';
import {
  HolderMove,
  HolderRevocation,
  HolderSessionBump,
  MovedHolders,
  NewCustomRole,
  PendingSweep,
  RoleActorRecord,
  RoleDeletionRecord,
  RoleEdit,
  RoleFieldsRejectedError,
  StoredRole,
} from '../../stores/role-records';
import { MongoRoleHolders } from './mongo-role-holders';
import { toPendingRoleSweep, toStoredRole } from './mongo-role-mappers';

/**
 * Takes a role at its write: the save conflicts with any other open
 * transaction that wrote the role, and MongoDB refuses the later writer at
 * once. Roles read in a unit of work are kept for it, so the write goes through
 * the document that was read.
 */
@Injectable()
export class MongoRoleChangeStore extends RoleChangeStore {
  private readonly holders: MongoRoleHolders;
  private readonly read = new WeakMap<UnitOfWork, Map<string, RoleDocument>>();

  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly events: SecurityEventService,
  ) {
    super();
    this.holders = new MongoRoleHolders(userModel, events);
  }

  async readActor(
    unitOfWork: UnitOfWork,
    actorId: string,
  ): Promise<RoleActorRecord | null> {
    const session = mongoSessionOf(unitOfWork);
    const actor = await this.userModel
      .findById(toObjectId(actorId))
      .session(session)
      .exec();
    if (!actor) return null;
    if (!actor.isDeleted) {
      await this.userModel.updateOne(
        { _id: actor._id },
        { $inc: { grantAuthorityFence: 1 } },
        { session, timestamps: false },
      );
    }
    return {
      isDeleted: Boolean(actor.isDeleted),
      roleSlug: actor.role,
      permissions: actor.permissions,
    };
  }

  async readRole(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<StoredRole | null> {
    const role = await this.roleModel
      .findById(toObjectId(roleId))
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return this.remember(unitOfWork, role);
  }

  async readRoleBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<StoredRole | null> {
    const role = await this.roleModel
      .findOne({ slug })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return this.remember(unitOfWork, role);
  }

  async readRoleAuthorityBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<StoredRole | null> {
    const role = await this.roleModel.findOneAndUpdate(
      { slug },
      { $inc: { grantAuthorityFence: 1 } },
      { new: true, session: mongoSessionOf(unitOfWork), timestamps: false },
    );
    return this.remember(unitOfWork, role);
  }

  takeRoleForChange(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<StoredRole | null> {
    return this.readRole(unitOfWork, roleId);
  }

  async insertCustomRole(
    unitOfWork: UnitOfWork,
    role: NewCustomRole,
  ): Promise<StoredRole> {
    const created = new this.roleModel({
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystemRole: false,
      isProtected: false,
      level: role.level,
      permissions: role.permissions,
      audience: role.audience,
    });
    await save(created, mongoSessionOf(unitOfWork));
    return toStoredRole(created);
  }

  async saveRoleEdit(
    unitOfWork: UnitOfWork,
    roleId: string,
    edit: RoleEdit,
  ): Promise<StoredRole> {
    const role = await this.recall(unitOfWork, roleId);
    if (edit.name !== undefined) role.name = edit.name;
    if (edit.slug !== undefined) role.slug = edit.slug;
    if (edit.description !== undefined) role.description = edit.description;
    if (edit.level !== undefined) role.level = edit.level;
    if (edit.permissions !== undefined) role.permissions = edit.permissions;
    if (edit.pendingHolderSweeps !== undefined) {
      role.pendingHolderSweeps =
        edit.pendingHolderSweeps.map(toPendingRoleSweep);
    }
    await save(role, mongoSessionOf(unitOfWork));
    return toStoredRole(role);
  }

  async savePendingSweeps(
    unitOfWork: UnitOfWork,
    ownerRoleId: string,
    sweeps: PendingSweep[],
  ): Promise<void> {
    const owner = await this.recall(unitOfWork, ownerRoleId);
    owner.pendingHolderSweeps = sweeps.map(toPendingRoleSweep);
    await save(owner, mongoSessionOf(unitOfWork));
  }

  countHoldersInWork(unitOfWork: UnitOfWork, slug: string): Promise<number> {
    return this.userModel
      .countDocuments({ role: slug })
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  async appendRoleDeletion(
    unitOfWork: UnitOfWork,
    deletion: RoleDeletionRecord,
  ): Promise<void> {
    await this.events.recordRoleDeletion(deletion, mongoSessionOf(unitOfWork));
  }

  async removeRole(unitOfWork: UnitOfWork, roleId: string): Promise<void> {
    await this.roleModel
      .deleteOne(
        { _id: toObjectId(roleId) },
        { session: mongoSessionOf(unitOfWork) },
      )
      .exec();
  }

  moveHolders(unitOfWork: UnitOfWork, move: HolderMove): Promise<MovedHolders> {
    return this.holders.moveHolders(unitOfWork, move);
  }

  bumpHolderSessions(
    unitOfWork: UnitOfWork,
    bump: HolderSessionBump,
  ): Promise<MovedHolders> {
    return this.holders.bumpHolderSessions(unitOfWork, bump);
  }

  appendHolderRevocations(
    unitOfWork: UnitOfWork,
    revocations: HolderRevocation[],
  ): Promise<void> {
    return this.holders.appendHolderRevocations(unitOfWork, revocations);
  }

  private remember(
    unitOfWork: UnitOfWork,
    role: RoleDocument | null,
  ): StoredRole | null {
    if (!role) return null;
    const stored = toStoredRole(role);
    const known = this.read.get(unitOfWork) ?? new Map<string, RoleDocument>();
    known.set(stored.id, role);
    this.read.set(unitOfWork, known);
    return stored;
  }

  /** The document this unit of work read for the role. */
  private async recall(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<RoleDocument> {
    const known = this.read.get(unitOfWork)?.get(roleId);
    if (known) return known;
    const role = await this.roleModel
      .findById(toObjectId(roleId))
      .session(mongoSessionOf(unitOfWork))
      .orFail()
      .exec();
    return role;
  }
}

/** A refusal by the schema's own rules is the store's to name. */
async function save(role: RoleDocument, session: ClientSession): Promise<void> {
  try {
    await role.save({ session });
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      throw new RoleFieldsRejectedError(error.message);
    }
    throw error;
  }
}
