import { Provider } from '@nestjs/common';
import { AccountPermissionStore } from '../../stores/account-permission.store';
import { AccountProfileStore } from '../../stores/account-profile.store';
import { AccountSessions } from '../../stores/account-sessions';
import { RevokerAccountSessions } from '../../stores/revoker-account-sessions';
import { SignInMethodStore } from '../../stores/sign-in-method.store';
import { MongoAccountPermissionStore } from './mongo-account-permission.store';
import { MongoAccountProfileStore } from './mongo-account-profile.store';
import { MongoSignInMethodStore } from './mongo-sign-in-method.store';

export const MONGO_ACCOUNT_PROFILE_STORE: Provider = {
  provide: AccountProfileStore,
  useClass: MongoAccountProfileStore,
};

export const MONGO_ACCOUNT_PERMISSION_STORE: Provider = {
  provide: AccountPermissionStore,
  useClass: MongoAccountPermissionStore,
};

export const MONGO_ACCOUNT_SESSIONS: Provider = {
  provide: AccountSessions,
  useClass: RevokerAccountSessions,
};

export const MONGO_SIGN_IN_METHOD_STORE: Provider = {
  provide: SignInMethodStore,
  useClass: MongoSignInMethodStore,
};

/** The account stores on MongoDB, each over the models it needs. */
export const MONGO_ACCOUNT_STORES: Provider[] = [
  MONGO_ACCOUNT_PROFILE_STORE,
  MONGO_ACCOUNT_PERMISSION_STORE,
  MONGO_ACCOUNT_SESSIONS,
  MONGO_SIGN_IN_METHOD_STORE,
];
