import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
// feature:passkeys:start
import {
  Passkey,
  PasskeyDocument,
} from '../../../auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { MongoRolePermissions } from '../../../role/persistence/mongo/mongo-role-permissions';
import {
  Role,
  RoleDocument,
} from '../../../role/persistence/mongo/schemas/role.schema';
import { RolePermissions } from '../../../role/stores/role-permissions';
import { toObjectId } from '../../../session/persistence/mongo/mongo-issuance-mappers';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { USER_HIDDEN_FIELDS } from '../../constants/user.constants';
import { UserRole } from '../../enums/user-role.enum';
import { User, UserDocument } from './schemas/user.schema';
import {
  AccountPassword,
  AccountProfileStore,
  AdminFence,
  ProfileChanges,
} from '../../stores/account-profile.store';
import { StoredAccount } from '../../stores/stored-account';
import { MongoAccountDocuments } from './mongo-account-records';

/**
 * The fence is a write to the admin role: it conflicts with any other open
 * transaction that wrote the role, and MongoDB refuses the later writer at
 * once.
 */
@Injectable()
export class MongoAccountProfileStore extends AccountProfileStore {
  private readonly read = new MongoAccountDocuments();
  private readonly roles: RolePermissions;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    // feature:passkeys:start
    @InjectModel(Passkey.name)
    private readonly passkeyModel: Model<PasskeyDocument>,
    // feature:passkeys:end
  ) {
    super();
    this.roles = new MongoRolePermissions(roleModel);
  }

  isAccountId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }

  async findProfile(userId: string): Promise<StoredAccount | null> {
    const user = await this.userModel
      .findById(userId)
      .select(USER_HIDDEN_FIELDS)
      .exec();
    return this.read.remember(user, userId);
  }

  async findAccount(userId: string): Promise<StoredAccount | null> {
    const user = await this.userModel.findById(userId).exec();
    return this.read.remember(user, userId);
  }

  async saveProfile(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    changes: ProfileChanges,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    if (changes.name !== undefined) {
      user.name = changes.name;
    }
    if (changes.locale !== undefined) {
      user.locale = changes.locale;
    }
    await user.save({ session: mongoSessionOf(unitOfWork) });
    return this.read.remember(user, account.id);
  }

  async findPassword(userId: string): Promise<AccountPassword | null> {
    const user = await this.userModel
      .findById(userId)
      .select('+password')
      .exec();
    if (!user) return null;
    return {
      id: userId,
      isDeleted: Boolean(user.isDeleted),
      passwordHash: user.password,
    };
  }

  async findPrimaryProvider(userId: string): Promise<string | undefined> {
    const user = await this.userModel
      .findById(userId)
      .select('primaryProvider')
      .exec();
    return user?.primaryProvider;
  }

  findRolePermissions(slug: string): Promise<string[] | null> {
    return this.roles.ofRole(slug);
  }

  // feature:passkeys:start
  async countPasskeys(userId: string): Promise<number> {
    return this.passkeyModel.countDocuments({
      user: toObjectId(userId),
    });
  }
  // feature:passkeys:end

  async readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    const user = await this.userModel
      .findById(userId)
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return this.read.remember(user, userId);
  }

  async savePasswordHash(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    passwordHash: string,
  ): Promise<void> {
    const user = this.read.documentOf(account);
    user.password = passwordHash;
    await user.save({ session: mongoSessionOf(unitOfWork) });
  }

  async saveDeactivation(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date,
  ): Promise<void> {
    const user = this.read.documentOf(account);
    user.isDeleted = true;
    user.deletedAt = deletedAt;
    await user.save({ session: mongoSessionOf(unitOfWork) });
  }

  countOtherActiveAdmins(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<number> {
    return this.userModel
      .countDocuments({
        _id: { $ne: toObjectId(userId) },
        role: UserRole.ADMIN,
        isDeleted: { $ne: true },
      })
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }

  async fenceAdminRole(unitOfWork: UnitOfWork): Promise<AdminFence> {
    const fenced = await this.roleModel
      .updateOne(
        { slug: UserRole.ADMIN },
        { $inc: { __v: 1 } },
        { session: mongoSessionOf(unitOfWork), timestamps: false },
      )
      .exec();
    return fenced.matchedCount === 1 ? 'fenced' : 'role_missing';
  }
}
