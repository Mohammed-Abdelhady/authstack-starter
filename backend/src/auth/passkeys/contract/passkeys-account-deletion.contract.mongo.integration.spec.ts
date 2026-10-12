import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { bootMongoAccountsHarness } from '../../../../test/utils/user/accounts-contract/mongo-accounts-harness';
import { MongoPasskeyAccounts } from '../persistence/mongo/mongo-passkey-accounts';
import { MongoPasskeyStore } from '../persistence/mongo/mongo-passkey.store';
import {
  Passkey,
  PasskeyDocument,
} from '../persistence/mongo/schemas/passkey.schema';
import { describePasskeysAfterDeletion } from './passkeys-account-deletion.harness-spec';

describePasskeysAfterDeletion(
  'MongoDB',
  async () => {
    const accounts = await bootMongoAccountsHarness();
    const { connection, users } = accounts.booted;
    const passkeys = connection.model<PasskeyDocument>(Passkey.name);
    await passkeys.init();
    return {
      accounts,
      passkeys: new MongoPasskeyStore(passkeys),
      passkeyAccounts: new MongoPasskeyAccounts(users),
    };
  },
  {
    bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
    teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
    resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  },
);
