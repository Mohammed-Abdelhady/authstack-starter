import { Provider } from '@nestjs/common';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { MongoAdminAccountStore } from './mongo-admin-account.store';

export const MONGO_ADMIN_ACCOUNT_STORE: Provider = {
  provide: AdminAccountStore,
  useClass: MongoAdminAccountStore,
};
