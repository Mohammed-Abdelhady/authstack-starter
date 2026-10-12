import { Injectable, Provider } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  accountConflictOr,
  MongoAccountDocuments,
} from '../../../../user/persistence/mongo/mongo-account-records';
import {
  User,
  UserDocument,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { StoredAccount } from '../../../../user/stores/stored-account';
import {
  NewProviderAccount,
  ProviderIdentity,
  ProviderSignInStore,
} from '../../stores/provider-sign-in.store';

/**
 * Links live in the account document, so a first sign-in writes the link, the
 * verification and the primary provider in one save. Any failure but a refused
 * unique rule leaves as the driver raised it.
 */
@Injectable()
export class MongoProviderSignInStore extends ProviderSignInStore {
  private readonly read = new MongoAccountDocuments();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  async findByIdentity(
    identity: ProviderIdentity,
  ): Promise<StoredAccount | null> {
    const user = await this.userModel.findOne({
      linkedAccounts: {
        $elemMatch: {
          provider: identity.provider,
          providerId: identity.providerId,
        },
      },
    });
    return this.read.remember(user);
  }

  async findByAddress(email: string): Promise<StoredAccount | null> {
    const user = await this.userModel.findOne({ email: { $eq: email } });
    return this.read.remember(user);
  }

  async linkFirstSignIn(
    account: StoredAccount,
    identity: ProviderIdentity,
  ): Promise<StoredAccount> {
    const user = this.read.documentOf(account);
    user.linkedAccounts.push({
      provider: identity.provider,
      providerId: identity.providerId,
      linkedAt: new Date(),
    });
    user.isVerified = true;
    if (!user.primaryProvider) {
      user.primaryProvider = identity.provider;
    }
    try {
      await user.save();
    } catch (error) {
      throw accountConflictOr(error);
    }
    return this.read.remember(user, account.id);
  }

  async createFromProvider(
    account: NewProviderAccount,
  ): Promise<StoredAccount> {
    try {
      const user = await this.userModel.create({
        email: account.email,
        name: account.name,
        avatarUrl: account.avatarUrl,
        isVerified: true,
        authProvider: account.provider,
        primaryProvider: account.provider,
        linkedAccounts: [
          {
            provider: account.provider,
            providerId: account.providerId,
            linkedAt: new Date(),
          },
        ],
        role: account.role,
      });
      return this.read.remember(user);
    } catch (error) {
      throw accountConflictOr(error);
    }
  }
}

export const MONGO_PROVIDER_SIGN_IN_STORE: Provider = {
  provide: ProviderSignInStore,
  useClass: MongoProviderSignInStore,
};
