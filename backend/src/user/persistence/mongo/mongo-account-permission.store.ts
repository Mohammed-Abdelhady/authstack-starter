import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { castingId } from '../../../session/persistence/mongo/mongo-session-records';
import { User, UserDocument } from './schemas/user.schema';
import {
  AccountGrants,
  AccountPermissionStore,
} from '../../stores/account-permission.store';
import { StoredAccount } from '../../stores/stored-account';
import { MongoAccountDocuments } from './mongo-account-records';

@Injectable()
export class MongoAccountPermissionStore extends AccountPermissionStore {
  private readonly read = new MongoAccountDocuments();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super();
  }

  isAccountId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }

  async findGrants(userId: string): Promise<AccountGrants | null> {
    const user = await castingId(() =>
      this.userModel.findById(userId).select('permissions role').exec(),
    );
    if (!user) return null;
    return {
      id: user._id.toString(),
      role: user.role,
      permissions: user.permissions || [],
    };
  }

  async findAccount(userId: string): Promise<StoredAccount | null> {
    const user = await castingId(() => this.userModel.findById(userId).exec());
    return this.read.remember(user, userId);
  }

  async grantPermission(
    account: StoredAccount,
    permission: string,
  ): Promise<string[]> {
    const user = this.read.documentOf(account);
    user.permissions.push(permission);
    await user.save();
    return [...user.permissions];
  }

  async revokePermission(
    account: StoredAccount,
    permission: string,
  ): Promise<string[]> {
    const user = this.read.documentOf(account);
    user.permissions = user.permissions.filter(
      (granted) => granted !== permission,
    );
    await user.save();
    return [...user.permissions];
  }
}
