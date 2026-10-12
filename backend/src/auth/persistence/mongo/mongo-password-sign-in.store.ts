import { Injectable, Provider } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoAccountDocuments } from '../../../user/persistence/mongo/mongo-account-records';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { StoredAccount } from '../../../user/stores/stored-account';
import {
  PasswordCandidate,
  PasswordSignInStore,
} from '../../stores/password-sign-in.store';

/**
 * The hash is `select: false` on the schema, so only the check asks for it.
 * A database failure leaves as the driver raised it: these routes never
 * answered one themselves.
 */
@Injectable()
export class MongoPasswordSignInStore extends PasswordSignInStore {
  private readonly read = new MongoAccountDocuments();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  async findForPasswordCheck(email: string): Promise<PasswordCandidate | null> {
    const user = await this.userModel
      .findOne({ email: { $eq: email }, isDeleted: { $ne: true } })
      .select('+password');
    if (!user) return null;
    return { account: this.read.remember(user), passwordHash: user.password };
  }

  async findActiveByAddress(email: string): Promise<StoredAccount | null> {
    const user = await this.userModel.findOne({
      email: { $eq: email },
      isDeleted: { $ne: true },
    });
    return this.read.remember(user);
  }

  async storeNewPassword(
    account: StoredAccount,
    passwordHash: string,
  ): Promise<void> {
    const user = this.read.documentOf(account);
    user.password = passwordHash;
    await user.save();
  }
}

export const MONGO_PASSWORD_SIGN_IN_STORE: Provider = {
  provide: PasswordSignInStore,
  useClass: MongoPasswordSignInStore,
};
