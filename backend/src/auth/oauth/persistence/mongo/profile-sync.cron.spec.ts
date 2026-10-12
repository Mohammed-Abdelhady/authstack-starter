import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { createConnection } from 'mongoose';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import {
  User,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { MONGO_LINKED_ACCOUNT_STORE } from '../../../../user/persistence/mongo/mongo-linked-account-stores';
import { ProfileSyncService } from '../../../../user/services/profile-sync.service';

describe('ProfileSyncService scheduled failure logging', () => {
  it('logs driver facts when the user query cannot connect', async () => {
    const clock = new FrozenClock(TEST_NOW);
    const connection = createConnection();
    const schema = UserSchema.clone();
    schema.set('bufferCommands', false);
    const users = connection.model<User>(User.name, schema);
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    jest.spyOn(Date, 'now').mockImplementation(() => clock.now().getTime());
    try {
      const module = await Test.createTestingModule({
        providers: [
          ProfileSyncService,
          MONGO_LINKED_ACCOUNT_STORE,
          ConfigService,
          { provide: getModelToken(User.name), useValue: users },
        ],
      }).compile();
      const service = module.get(ProfileSyncService);
      await service.scheduleProfileSync();
      expect(error).toHaveBeenCalledWith(
        'Automatic profile sync failed: name=MongooseError',
      );
    } finally {
      jest.restoreAllMocks();
      await connection.close();
    }
  });
});
