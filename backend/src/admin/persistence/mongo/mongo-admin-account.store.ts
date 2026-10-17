import { mongoAdminActivity } from './mongo-admin-activity';
import { EMAIL_CHANGE_INITIATOR } from '../../../auth/constants/email-change-initiator';
import { assertMongoAccountAudience } from '../../../user/persistence/mongo/mongo-account-audience';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  Role,
  RoleDocument,
} from '../../../role/persistence/mongo/schemas/role.schema';
import { castingId } from '../../../session/persistence/mongo/mongo-session-records';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { AuthProvider } from '../../../user/enums/auth-provider.enum';
import {
  accountConflictOr,
  MongoAccountDocuments,
} from '../../../user/persistence/mongo/mongo-account-records';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { StoredAccount } from '../../../user/stores/stored-account';
import { ADMIN_USER_HIDDEN_FIELDS } from '../../constants/admin-user.constants';
import {
  AccountIdentityEdit,
  AdminAccountPage,
  AdminAccountQuery,
  AdminAccountStore,
  AssignableRole,
  CreatedAccountMark,
  NewAdminAccount,
} from '../../stores/admin-account.store';
import { buildUserFilter, buildUserSort } from '../../utils/user-filter.util';

/**
 * Takes an account at its write: the save conflicts with any other open
 * transaction that wrote the account, and MongoDB refuses the later writer at
 * once. A committed read that fails for an outage leaves as the shared error.
 */
@Injectable()
export class MongoAdminAccountStore extends AdminAccountStore {
  private readonly read = new MongoAccountDocuments();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {
    super();
  }

  lastActiveFor(
    userIds: readonly string[],
    work?: UnitOfWork,
  ): Promise<Map<string, Date | null>> {
    return singleStatement(() =>
      mongoAdminActivity(
        this.userModel,
        userIds,
        work === undefined ? undefined : mongoSessionOf(work),
      ),
    );
  }

  async findAccount(userId: string): Promise<StoredAccount | null> {
    const user = await singleStatement(() =>
      castingId(() => this.userModel.findById(userId).exec()),
    );
    return this.read.remember(user, userId);
  }

  async findAccountView(userId: string): Promise<StoredAccount | null> {
    const user = await singleStatement(() =>
      castingId(() =>
        this.userModel.findById(userId).select(ADMIN_USER_HIDDEN_FIELDS).exec(),
      ),
    );
    return this.read.remember(user, userId);
  }

  async listAccounts(query: AdminAccountQuery): Promise<AdminAccountPage> {
    const filter = buildUserFilter(query, query.viewableRoles);
    const [users, total] = await singleStatement(() =>
      Promise.all([
        this.userModel
          .find(filter)
          .select(ADMIN_USER_HIDDEN_FIELDS)
          .sort(buildUserSort(query.sortBy, query.sortOrder))
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .exec(),
        this.userModel.countDocuments(filter),
      ]),
    );
    return {
      accounts: users.map((user) => this.read.remember(user)),
      total,
    };
  }

  async isAddressTaken(email: string): Promise<boolean> {
    const taken = await singleStatement(() =>
      this.userModel.findOne({ email: { $eq: email } }).exec(),
    );
    return Boolean(taken);
  }

  async findRole(roleId: string): Promise<AssignableRole | null> {
    const role = await singleStatement(() =>
      this.roleModel.findById(roleId).exec(),
    );
    return toAssignableRole(role);
  }

  async findRoleBySlug(slug: string): Promise<AssignableRole | null> {
    const role = await singleStatement(() =>
      this.roleModel.findOne({ slug }).exec(),
    );
    return toAssignableRole(role);
  }

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

  takeAccountForChange(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    return this.readAccount(unitOfWork, userId);
  }

  async takeEmailChangeTarget(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null> {
    const user = await castingId(() =>
      this.userModel
        .findOneAndUpdate(
          { _id: userId },
          { $inc: { issuanceFence: 1 } },
          { session: mongoSessionOf(unitOfWork), new: true },
        )
        .exec(),
    );
    return this.read.remember(user, userId);
  }

  async readRoleBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<AssignableRole | null> {
    const role = await this.roleModel
      .findOne({ slug })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return toAssignableRole(role);
  }

  saveActivation(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date | undefined,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    user.isDeleted = deletedAt !== undefined;
    user.deletedAt = deletedAt;
    return this.save(user, mongoSessionOf(unitOfWork), account.id);
  }

  saveRole(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    slug: string,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    user.role = slug;
    return this.save(user, mongoSessionOf(unitOfWork), account.id);
  }

  saveIdentity(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    edit: AccountIdentityEdit,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    if (edit.name !== undefined) {
      user.name = edit.name;
    }
    if (edit.address) {
      user.pendingEmail = edit.address.email ?? undefined;
      user.pendingEmailInitiator =
        edit.address.email === null ? undefined : EMAIL_CHANGE_INITIATOR.STAFF;
      user.addressGeneration = edit.address.addressGeneration;
    }
    return this.save(user, mongoSessionOf(unitOfWork), account.id);
  }

  savePermissions(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    permissions: string[],
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    user.permissions = permissions;
    return this.save(user, mongoSessionOf(unitOfWork), account.id);
  }

  async insertAccount(
    unitOfWork: UnitOfWork,
    account: NewAdminAccount,
  ): Promise<StoredAccount> {
    await assertMongoAccountAudience(
      this.userModel.db,
      unitOfWork,
      account.role,
      account.audience,
    );
    const user = new this.userModel({
      email: account.email,
      name: account.name,
      password: account.passwordHash,
      role: account.role,
      isVerified: true,
      permissions: [],
      authProvider: AuthProvider.EMAIL,
      primaryProvider: AuthProvider.EMAIL,
      locale: account.locale,
      audience: account.audience,
    });
    try {
      await user.save({ session: mongoSessionOf(unitOfWork) });
    } catch (error) {
      throw accountConflictOr(error);
    }
    return this.read.remember(user);
  }

  async removeCreatedAccount(
    unitOfWork: UnitOfWork,
    created: CreatedAccountMark,
  ): Promise<void> {
    await this.userModel
      .deleteOne(
        {
          _id: created.id,
          role: created.role,
          updatedAt: created.updatedAt,
          sessionVersion: created.sessionVersion,
        },
        { session: mongoSessionOf(unitOfWork) },
      )
      .exec();
  }

  private async save(
    user: UserDocument,
    session: ClientSession,
    id?: string,
  ): Promise<StoredAccount> {
    try {
      await user.save({ session });
    } catch (error) {
      throw accountConflictOr(error);
    }
    return this.read.remember(user, id);
  }
}

function toAssignableRole(
  role: {
    _id: { toString(): string };
    slug: string;
    audience?: AssignableRole['audience'] | null;
  } | null,
): AssignableRole | null {
  return role
    ? {
        id: role._id.toString(),
        slug: role.slug,
        audience: role.audience ?? undefined,
      }
    : null;
}
