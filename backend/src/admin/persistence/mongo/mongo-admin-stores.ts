import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  User,
  UserDocument,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  AdminRosterLock,
  AdminRosterLockDocument,
  AdminRosterLockSchema,
} from './admin-roster-lock.schema';
import { Provider } from '@nestjs/common';
import { AdminRosterStore } from '../../stores/admin-roster.store';
import { MongoAdminRosterStore } from './mongo-admin-roster.store';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { MongoAdminAccountStore } from './mongo-admin-account.store';

export const MONGO_ADMIN_ACCOUNT_STORE: Provider = {
  provide: AdminAccountStore,
  useClass: MongoAdminAccountStore,
};

export const MONGO_ADMIN_ROSTER_STORE: Provider = {
  provide: AdminRosterStore,
  inject: [getModelToken(User.name), getConnectionToken()],
  useFactory: (users: Model<UserDocument>, connection: Connection) => {
    connection.model(AdminRosterLock.name, AdminRosterLockSchema);
    return new MongoAdminRosterStore(
      users,
      connection.model<AdminRosterLockDocument>(AdminRosterLock.name),
    );
  },
};
