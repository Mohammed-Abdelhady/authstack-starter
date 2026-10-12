import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { User, UserDocument } from './schemas/user.schema';
import {
  LinkedAccountStore,
  LinkedProviders,
  PrimaryProviderState,
  SyncedProfile,
  SyncStatus,
} from '../../stores/linked-account.store';
import { StoredAccount } from '../../stores/stored-account';
import {
  accountConflictOr,
  MongoAccountDocuments,
} from './mongo-account-records';

const LINKED_ACCOUNT_FIELDS = 'linkedAccounts authProvider primaryProvider';
const SYNC_BATCH_FIELDS = '_id primaryProvider';

/**
 * Links live in the account document, under one unique index over provider and
 * provider id, so a link is written with the account.
 */
@Injectable()
export class MongoLinkedAccountStore extends LinkedAccountStore {
  private readonly read = new MongoAccountDocuments();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  async findAccount(userId: string): Promise<StoredAccount | null> {
    const user = await this.userModel.findById(userId).exec();
    return this.read.remember(user, userId);
  }

  async findLinks(userId: string): Promise<StoredAccount | null> {
    const query = this.userModel.findById(userId);
    query.select(`${LINKED_ACCOUNT_FIELDS} isDeleted`);
    return this.read.remember(await query.exec(), userId);
  }

  async findLinkedProviders(userId: string): Promise<LinkedProviders | null> {
    const user = await this.userModel
      .findById(userId)
      .select(LINKED_ACCOUNT_FIELDS)
      .exec();
    if (!user) return null;
    return { linkedProviders: user.linkedProviders };
  }

  async findPrimaryProviderState(
    userId: string,
  ): Promise<PrimaryProviderState | null> {
    const user = await this.userModel
      .findById(userId)
      .select('primaryProvider isDeleted')
      .exec();
    if (!user) return null;
    return {
      isDeleted: Boolean(user.isDeleted),
      primaryProvider: user.primaryProvider,
    };
  }

  async addLink(
    account: StoredAccount,
    link: { provider: string; providerId: string; primaryProvider?: string },
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    const before = {
      linkedAccounts: [...user.linkedAccounts],
      primaryProvider: user.primaryProvider,
    };
    user.linkedAccounts.push({
      provider: link.provider,
      providerId: link.providerId,
      linkedAt: new Date(),
    });
    if (link.primaryProvider !== undefined) {
      user.primaryProvider = link.primaryProvider;
    }
    try {
      await user.save();
    } catch (error) {
      // A refused link must not ride along with the next write of this account.
      user.linkedAccounts = before.linkedAccounts;
      user.primaryProvider = before.primaryProvider;
      throw accountConflictOr(error);
    }
    return this.read.remember(user, account.id);
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

  async removeLink(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    unlink: { provider: string; primaryProvider: string | undefined },
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    user.linkedAccounts = user.linkedAccounts.filter(
      (linked) => linked.provider !== unlink.provider,
    );
    if (user.primaryProvider !== unlink.primaryProvider) {
      user.primaryProvider = unlink.primaryProvider;
    }
    await user.save({ session: mongoSessionOf(unitOfWork) });
    return this.read.remember(user, account.id);
  }

  async savePrimaryProvider(
    account: StoredAccount,
    provider: string,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    user.primaryProvider = provider;
    await user.save();
    return this.read.remember(user, account.id);
  }

  async findSyncTarget(userId: string): Promise<StoredAccount | null> {
    const user = await this.userModel.findById(userId);
    return this.read.remember(user, userId);
  }

  async saveSyncedProfile(
    account: StoredAccount,
    profile: SyncedProfile,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    if (profile.name !== undefined) user.name = profile.name;
    if (profile.avatarUrl !== undefined) user.avatarUrl = profile.avatarUrl;
    user.profileSyncedAt = profile.profileSyncedAt;
    user.lastSyncedProvider = profile.lastSyncedProvider;
    await user.save();
    return this.read.remember(user, account.id);
  }

  async findSyncSource(
    userId: string,
  ): Promise<{ primaryProvider?: string } | null> {
    const user = await this.userModel
      .findById(userId)
      .select('primaryProvider linkedAccounts authProvider');
    return user ? { primaryProvider: user.primaryProvider } : null;
  }

  async findSyncStatus(userId: string): Promise<SyncStatus | null> {
    const user = await this.userModel
      .findById(userId)
      .select('profileSyncedAt lastSyncedProvider primaryProvider');
    if (!user) return null;
    return {
      profileSyncedAt: user.profileSyncedAt,
      lastSyncedProvider: user.lastSyncedProvider,
      primaryProvider: user.primaryProvider,
    };
  }

  async findConflictSource(
    userId: string,
  ): Promise<{ primaryProvider?: string } | null> {
    const user = await this.userModel
      .findById(userId)
      .select('primaryProvider');
    return user ? { primaryProvider: user.primaryProvider } : null;
  }

  async countDueForSync(
    before: Date,
    primaryProviderNot: string,
    limit: number,
  ): Promise<number> {
    const due = await this.userModel
      .find({
        primaryProvider: { $ne: primaryProviderNot },
        $or: [
          { profileSyncedAt: { $lt: before } },
          { profileSyncedAt: { $exists: false } },
        ],
      })
      .limit(limit)
      .select(SYNC_BATCH_FIELDS);
    return due.length;
  }
}
