import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { refusalAnswer } from '../utils/route-id-answers';

interface PasskeyList {
  data: { passkeys: { id: string; name: string }[] };
}

describe('renaming a passkey (e2e)', () => {
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

  async function listedNames(
    browser: Awaited<ReturnType<typeof loginAs>>,
  ): Promise<string[]> {
    const listed = await browser.get('/api/auth/passkeys').expect(200);
    return (listed.body as PasskeyList).data.passkeys.map(
      (passkey) => passkey.name,
    );
  }

  it('answers not found for a passkey of another account, and renames nothing', async () => {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    const passkeyId = await storePasskey();
    const stranger = await loginAs(e2e.httpServer, SEED_ADMIN);

    const refused = await stranger
      .patch(`/api/auth/passkeys/${passkeyId}`)
      .send({ name: 'Taken over' });

    expect(refusalAnswer(refused)).toMatchObject({
      status: 404,
      success: false,
      code: ErrorCode.PASSKEY_NOT_FOUND,
    });
    expect(await listedNames(owner)).toEqual(['Laptop']);
  });
});
