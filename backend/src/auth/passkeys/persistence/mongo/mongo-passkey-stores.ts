import { Provider } from '@nestjs/common';
import { PasskeyAccounts, PasskeySignIn } from '../../stores/passkey-accounts';
import { PasskeyChallengeStore } from '../../stores/passkey-challenge.store';
import { PasskeyStore } from '../../stores/passkey.store';
import {
  MongoPasskeyAccounts,
  MongoPasskeySignIn,
} from './mongo-passkey-accounts';
import { MongoPasskeyChallengeStore } from './mongo-passkey-challenge.store';
import { MongoPasskeyStore } from './mongo-passkey.store';

/** The passkey stores on MongoDB, each over the model it needs. */
export const MONGO_PASSKEY_STORES: Provider[] = [
  { provide: PasskeyStore, useClass: MongoPasskeyStore },
  { provide: PasskeyChallengeStore, useClass: MongoPasskeyChallengeStore },
  { provide: PasskeyAccounts, useClass: MongoPasskeyAccounts },
  { provide: PasskeySignIn, useClass: MongoPasskeySignIn },
];
