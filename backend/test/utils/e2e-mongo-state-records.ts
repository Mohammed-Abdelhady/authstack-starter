import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  User,
  type UserDocument,
} from '../../src/user/persistence/mongo/schemas/user.schema';
import type { E2eRecordsState } from './e2e-state-records';

/** The records state on MongoDB: the calls the cases made on the user model. */
export function mongoRecordsState(app: INestApplication): E2eRecordsState {
  const users = app.get<Model<UserDocument>>(getModelToken(User.name));
  return {
    changeAccountRole: async (id, role) => {
      await users.updateOne({ _id: id }, { $set: { role } });
    },
    markAccountDeleted: async (id) => {
      await users.updateOne({ _id: id }, { $set: { isDeleted: true } });
    },
    replaceAccountPermissions: async (id, permissions) => {
      await users.updateOne({ _id: id }, { permissions });
    },
    moveAddressGeneration: async (id, generation, isVerified) => {
      await users.updateOne(
        { _id: id },
        { $set: { addressGeneration: generation, isVerified } },
      );
    },
  };
}
