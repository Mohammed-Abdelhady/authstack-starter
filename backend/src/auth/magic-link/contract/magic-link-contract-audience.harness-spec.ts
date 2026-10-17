import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import { ROLE_AUDIENCE } from '../../../host/types/host-role.type';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { refusalOf } from '../../../../test/utils/user/accounts-contract/accounts-contract-support';
import type { BrowserSignInConfiguration } from '../../../config/types/host-policy.type';
import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  linkBrowser,
  linkServices,
  type MagicLinkHarnessSource,
} from './magic-link-contract.harness-spec';

const EMAIL = 'audience-link@example.test';
const TOKEN = 'audience-link-token';
const EXPIRY = new Date('2099-01-01T12:15:00.000Z');

export function magicLinkAudienceCases(harness: MagicLinkHarnessSource): void {
  async function verify(
    signIn: BrowserSignInConfiguration,
    configuredSignIn: BrowserSignInConfiguration = {},
  ) {
    const h = harness();
    await h.setApplicationPolicy(WEB_CLIENT_ID, signIn);
    const services = linkServices(h, undefined, configuredSignIn);
    await h.seedLink({
      email: EMAIL,
      tokenHash: hashMagicLinkToken(TOKEN),
      createdAt: TEST_NOW,
      expiresAt: EXPIRY,
    });
    const browser = linkBrowser();
    const outcome = services.service.verify(
      { token: TOKEN, confirm: true },
      browser.request,
      browser.response,
    );
    return { services, outcome };
  }

  // Failure: process configuration overrides the stored creation audience.
  it.each([
    {
      name: 'stored customer with no process audience',
      stored: ROLE_AUDIENCE.CUSTOMER,
      otherStored: undefined,
      configured: undefined,
      expected: ROLE_AUDIENCE.CUSTOMER,
    },
    {
      name: 'stored unrestricted web while another application names staff',
      stored: undefined,
      otherStored: ROLE_AUDIENCE.STAFF,
      configured: undefined,
      expected: ROLE_AUDIENCE.CUSTOMER,
    },
    {
      name: 'no stored audience despite stale process customer policy',
      stored: undefined,
      otherStored: undefined,
      configured: ROLE_AUDIENCE.CUSTOMER,
      expected: undefined,
    },
  ])(
    'persists the creation audience for $name',
    async ({ stored, otherStored, configured, expected }) => {
      const h = harness();
      await h.seedDefaultRoleAudience(ROLE_AUDIENCE.CUSTOMER);
      await h.setApplicationPolicy(ADMIN_CLIENT_ID, {
        audience: otherStored,
        signUp: 'closed',
      });
      const { outcome } = await verify(
        { audience: stored },
        { audience: configured },
      );
      await outcome;
      expect((await h.account(EMAIL))?.audience).toBe(expected);
      expect(await h.claimCount()).toBe(0);
    },
  );

  // Failure: a closed application creates an account through its verifier.
  it.each([ROLE_AUDIENCE.CUSTOMER, ROLE_AUDIENCE.STAFF])(
    'refuses unknown creation for a closed %s application',
    async (audience) => {
      const h = harness();
      await h.seedDefaultRoleAudience(ROLE_AUDIENCE.CUSTOMER);
      const { services, outcome } = await verify({
        audience,
        signUp: 'closed',
      });
      expect(await refusalOf(outcome)).toEqual({
        code: 'MAGIC_LINK_INVALID',
        status: 400,
      });
      expect(await h.account(EMAIL)).toBeNull();
      expect(await h.claimCount()).toBe(0);
      expect(services.signedIn).toEqual([]);
    },
  );

  // Failure: stale closed process configuration overrides the stored open policy.
  it('uses stored open signup when process configuration still says closed', async () => {
    const h = harness();
    await h.seedDefaultRoleAudience(ROLE_AUDIENCE.CUSTOMER);
    const { outcome } = await verify(
      { audience: ROLE_AUDIENCE.CUSTOMER, signUp: 'open' },
      { audience: ROLE_AUDIENCE.CUSTOMER, signUp: 'closed' },
    );

    await outcome;

    expect((await h.account(EMAIL))?.audience).toBe(ROLE_AUDIENCE.CUSTOMER);
    expect(await h.claimCount()).toBe(0);
  });

  // Failure: creation commits with a missing or incompatible default audience.
  it.each([undefined, ROLE_AUDIENCE.STAFF])(
    'rolls creation back when the default role audience is %s',
    async (roleAudience) => {
      const h = harness();
      await h.seedDefaultRoleAudience(roleAudience);
      const { services, outcome } = await verify({
        audience: ROLE_AUDIENCE.CUSTOMER,
      });
      expect(await refusalOf(outcome)).toEqual({
        code: 'MAGIC_LINK_INVALID',
        status: 400,
      });
      expect(await h.account(EMAIL)).toBeNull();
      expect(await h.claimCount()).toBe(0);
      expect(services.signedIn).toEqual([]);
    },
  );
}
