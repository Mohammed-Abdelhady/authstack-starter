import { SEED_USER_DEFINITIONS } from '../../src/database/seeds/user.seed';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

async function expectNoSeedAccounts(fixture: E2eApp): Promise<void> {
  for (const definition of SEED_USER_DEFINITIONS) {
    expect(
      await fixture.state.accounts.accountIdFor(definition.email),
    ).toBeNull();
  }
}

describe('unseeded host-role fixture', () => {
  let fixture: E2eApp | undefined;

  afterEach(async () => {
    const current = fixture;
    fixture = undefined;
    await current?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it(
    'boots and resets without creating configured seed accounts',
    async () => {
      const started = bootE2eApp(0, { seedUsers: false }).then((created) => {
        fixture = created;
        return created;
      });
      await expect(started).resolves.toBeDefined();
      const current = await started;
      await expectNoSeedAccounts(current);
      await expect(current.reset()).resolves.toBeUndefined();
      await expectNoSeedAccounts(current);
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );
});
