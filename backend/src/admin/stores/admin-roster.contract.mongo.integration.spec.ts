import { bootMongoAdminRosterHarness } from '../../../test/utils/admin-roster-contract/mongo-admin-roster-harness';
import { describeAdminRosterContract } from '../../../test/utils/admin-roster-contract/admin-roster-contract';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/hook-timeouts';

describeAdminRosterContract('MongoDB', bootMongoAdminRosterHarness, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  resetMs: SESSION_AUTHORITY_RESET_TIMEOUT_MS,
});

// Malformed exclusions must not break the safeguard against removing the last administrator.
it(
  'ignores malformed excluded ids on MongoDB',
  async () => {
    const h = await bootMongoAdminRosterHarness();
    try {
      await h.reset();
      await h.seedAccount({
        email: 'admin@example.com',
        role: 'admin',
        verified: true,
      });
      const result = await h.runner().run((uow) =>
        h.roster.countAdminsWhoCanSignIn(uow, {
          passkeyRelyingParty: null,
          excluding: ['not-an-object-id', '', '123'],
        }),
      );
      expect(result).toBe(1);
    } finally {
      await h.close();
    }
  },
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
);
