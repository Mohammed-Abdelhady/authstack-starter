import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { bootMongoAccountsHarness } from '../../../../test/utils/user/accounts-contract/mongo-accounts-harness';
import { MongoSecondFactorStore } from '../persistence/mongo/mongo-second-factor.store';
import { describeSecondFactorAfterDeletion } from './two-factor-account-deletion.harness-spec';

describeSecondFactorAfterDeletion(
  'MongoDB',
  async () => {
    const accounts = await bootMongoAccountsHarness();
    return {
      accounts,
      secondFactor: new MongoSecondFactorStore(accounts.booted.users),
    };
  },
  {
    bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
    teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
    resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  },
);
