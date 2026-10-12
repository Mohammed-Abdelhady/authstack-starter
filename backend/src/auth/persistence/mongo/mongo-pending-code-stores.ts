import { Provider } from '@nestjs/common';
import { MailCounterStore } from '../../pending-codes/mail-counter.store';
import { PasswordResetCodeStore } from '../../pending-codes/password-reset-code.store';
import { PendingRegistrationStore } from '../../pending-codes/pending-registration.store';
import { MongoMailCounterStore } from './mongo-mail-counter.store';
import { MongoPasswordResetCodeStore } from './mongo-password-reset-code.store';
import { MongoPendingRegistrationStore } from './mongo-pending-registration.store';

export const MONGO_MAIL_COUNTER_STORE: Provider = {
  provide: MailCounterStore,
  useClass: MongoMailCounterStore,
};

export const MONGO_PENDING_REGISTRATION_STORE: Provider = {
  provide: PendingRegistrationStore,
  useClass: MongoPendingRegistrationStore,
};

export const MONGO_PASSWORD_RESET_CODE_STORE: Provider = {
  provide: PasswordResetCodeStore,
  useClass: MongoPasswordResetCodeStore,
};

/** The pending-code stores on MongoDB, each over its own model. */
export const MONGO_PENDING_CODE_STORES: Provider[] = [
  MONGO_MAIL_COUNTER_STORE,
  MONGO_PENDING_REGISTRATION_STORE,
  MONGO_PASSWORD_RESET_CODE_STORE,
];
