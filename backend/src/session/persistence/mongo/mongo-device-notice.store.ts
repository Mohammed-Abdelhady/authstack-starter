import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { storedLocale } from '../../../common/constants/locales';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { DeviceNoticeStore } from '../../notices/device-notice.store';
import type { RememberedDevices } from '../../notices/types/device-notice';
import { toObjectId } from './mongo-issuance-mappers';
import { mongoSessionOf } from './mongo-unit-of-work';

@Injectable()
export class MongoDeviceNoticeStore extends DeviceNoticeStore {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    super();
  }

  async take(work: UnitOfWork, userId: string) {
    const user = await this.users
      .findOneAndUpdate(
        { _id: toObjectId(userId), isDeleted: { $ne: true } },
        { $inc: { noticeFence: 1 } },
        { session: mongoSessionOf(work), returnDocument: 'after' },
      )
      .exec();
    return user
      ? {
          email: user.email,
          locale: storedLocale(user.locale),
          verified: user.isVerified,
          signIns: user.issuanceFence,
          devices: user.signInDevices ?? null,
        }
      : null;
  }

  async save(
    work: UnitOfWork,
    userId: string,
    devices: RememberedDevices,
  ): Promise<void> {
    await this.users
      .updateOne(
        { _id: toObjectId(userId) },
        { $set: { signInDevices: devices } },
        { session: mongoSessionOf(work) },
      )
      .exec();
  }
}
