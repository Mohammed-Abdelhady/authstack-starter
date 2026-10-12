import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { refusalAnswer } from '../utils/route-id-answers';

const GOOGLE_LINK = {
  provider: 'google',
  providerId: 'google-1',
  linkedAt: TEST_NOW,
};

interface ProvidersBody {
  data: { providers: string[]; unlinkHints: Record<string, string> };
}

describe('an unlink the server refuses (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    // Magic links are off in this fixture, so a provider can be the only way in.
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  async function providers(browser: TestAgent): Promise<ProvidersBody['data']> {
    const listed = await browser.get('/api/user/linked-providers').expect(200);
    return (listed.body as ProvidersBody).data;
  }

  it('keeps the provider that is the only way into the account', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await e2e.state.auth.makeProviderCreated(SEED_USER.email, 'google', [
      GOOGLE_LINK,
    ]);
    await e2e.state.auth.removePassword(SEED_USER.email);

    // The list says so before the unlink is tried.
    expect((await providers(browser)).unlinkHints).toEqual({
      google: 'last_sign_in_method',
    });
    const refused = await browser.delete('/api/user/unlink-provider/google');

    expect(refusalAnswer(refused)).toMatchObject({
      status: 400,
      success: false,
      code: ErrorCode.CANNOT_UNLINK_LAST_PROVIDER,
    });
    expect((await providers(browser)).providers).toEqual(['google']);
  });

  it('refuses a provider the account never linked, and changes nothing', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await e2e.state.auth.linkProviderAccounts(SEED_USER.email, [GOOGLE_LINK]);

    const refused = await browser.delete('/api/user/unlink-provider/github');

    expect(refusalAnswer(refused)).toMatchObject({
      status: 400,
      success: false,
      code: ErrorCode.PROVIDER_NOT_LINKED,
    });
    expect((await providers(browser)).providers).toEqual(['email', 'google']);
  });

  it('refuses to unlink email sign-in itself', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await e2e.state.auth.linkProviderAccounts(SEED_USER.email, [GOOGLE_LINK]);

    const refused = await browser.delete('/api/user/unlink-provider/email');

    expect(refusalAnswer(refused)).toMatchObject({
      status: 400,
      success: false,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect((await providers(browser)).providers).toEqual(['email', 'google']);
  });
});
