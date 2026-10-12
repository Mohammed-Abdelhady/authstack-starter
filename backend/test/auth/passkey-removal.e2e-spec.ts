import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface PasskeyList {
  data: { passkeys: { id: string }[]; canRemove?: boolean };
}

describe('removing a passkey (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await e2e.state.auth.removeEveryPasskey();
  });

  /** A passkey stored for the seeded user, the way a registration leaves one. */
  function storePasskey(): Promise<string> {
    return e2e.state.auth.storePasskey(SEED_USER.email, {
      credentialId: 'ZTJlLWNyZWRlbnRpYWw',
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Laptop',
      lastUsedAt: null,
    });
  }

  // feature:email-password:start
  it('removes the passkey of an account that still has its password', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const passkeyId = await storePasskey();

    const offered = await browser.get('/api/auth/passkeys').expect(200);
    expect((offered.body as PasskeyList).data.canRemove).toBe(true);
    await browser.delete(`/api/auth/passkeys/${passkeyId}`).expect(200);

    const listed = await browser.get('/api/auth/passkeys').expect(200);
    expect((listed.body as PasskeyList).data.passkeys).toEqual([]);
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
  });
  // feature:email-password:end

  it('refuses to remove the passkey that is the only way in', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const passkeyId = await storePasskey();
    // Signed in already; from here the account has no password to fall back on.
    await e2e.state.auth.removePassword(SEED_USER.email);

    // The list says so before the removal is tried.
    const advised = await browser.get('/api/auth/passkeys').expect(200);
    expect((advised.body as PasskeyList).data.canRemove).toBe(false);
    const refused = await browser.delete(`/api/auth/passkeys/${passkeyId}`);

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      success: false,
      error: { code: 'PASSKEY_LAST_SIGN_IN_METHOD' },
    });
    const listed = await browser.get('/api/auth/passkeys').expect(200);
    expect((listed.body as PasskeyList).data.passkeys).toEqual([
      expect.objectContaining({ id: passkeyId }),
    ]);
    expect(await e2e.state.auth.countPasskeys()).toBe(1);
  });
});
