// feature:passkeys:start
import { InjectConnection } from '@nestjs/mongoose';
import { Injectable } from '@nestjs/common';
import { Connection, Types } from 'mongoose';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { PasskeyResetStore } from '../../passkey-reset/passkey-reset.store';

@Injectable()
export class MongoPasskeyResetStore extends PasskeyResetStore {
  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  async removeAll(work: UnitOfWork, userId: string): Promise<void> {
    await this.connection
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        { $inc: { version: 1 } },
        { session: mongoSessionOf(work) },
      );
    await this.connection
      .collection('passkeys')
      .deleteMany(
        { user: new Types.ObjectId(userId) },
        { session: mongoSessionOf(work) },
      );
  }
}

export const MONGO_PASSKEY_RESET_PROVIDER = {
  provide: PasskeyResetStore,
  useClass: MongoPasskeyResetStore,
};
// feature:passkeys:end
