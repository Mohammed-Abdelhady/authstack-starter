import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ABSENT_ID,
  MALFORMED_ID_ANSWER,
  MALFORMED_IDS,
  refusalAnswer,
} from '../utils/route-id-answers';

interface PasskeyBody {
  data: { id: string; name: string };
}

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

  it('renames the passkey, trimmed, and lists it under the new name', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const passkeyId = await storePasskey();

    const renamed = await browser
      .patch(`/api/auth/passkeys/${passkeyId}`)
      .send({ name: '  Work phone  ' });

    expect(renamed.status).toBe(200);
    expect((renamed.body as PasskeyBody).data).toMatchObject({
      id: passkeyId,
      name: 'Work phone',
    });
    expect(await listedNames(browser)).toEqual(['Work phone']);
  });

  it.each([
    ['empty', ''],
    ['65 characters long', 'n'.repeat(65)],
  ])('refuses a name that is %s and keeps the old one', async (_form, name) => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const passkeyId = await storePasskey();

    const refused = await browser
      .patch(`/api/auth/passkeys/${passkeyId}`)
      .send({ name });

    expect(refusalAnswer(refused)).toMatchObject({
      status: 400,
      success: false,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(await listedNames(browser)).toEqual(['Laptop']);
  });

  it('accepts a name of 64 characters', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const passkeyId = await storePasskey();

    await browser
      .patch(`/api/auth/passkeys/${passkeyId}`)
      .send({ name: 'n'.repeat(64) })
      .expect(200);

    expect(await listedNames(browser)).toEqual(['n'.repeat(64)]);
  });

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

  it('answers not found for an id that names no passkey', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await storePasskey();

    const refused = await browser
      .patch(`/api/auth/passkeys/${ABSENT_ID}`)
      .send({ name: 'Nobody' });

    expect(refusalAnswer(refused)).toMatchObject({
      status: 404,
      success: false,
      code: ErrorCode.PASSKEY_NOT_FOUND,
    });
  });

  it('refuses an id this database could not have issued', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await storePasskey();

    const refused = await browser
      .patch(`/api/auth/passkeys/${MALFORMED_IDS[0][1]}`)
      .send({ name: 'Nobody' });

    expect(refusalAnswer(refused)).toEqual(MALFORMED_ID_ANSWER);
    expect(await listedNames(browser)).toEqual(['Laptop']);
  });
});
