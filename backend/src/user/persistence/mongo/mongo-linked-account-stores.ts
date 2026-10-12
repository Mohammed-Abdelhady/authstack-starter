import { Provider } from '@nestjs/common';
import { LinkedAccountStore } from '../../stores/linked-account.store';
import { MongoLinkedAccountStore } from './mongo-linked-account.store';

export const MONGO_LINKED_ACCOUNT_STORE: Provider = {
  provide: LinkedAccountStore,
  useClass: MongoLinkedAccountStore,
};
