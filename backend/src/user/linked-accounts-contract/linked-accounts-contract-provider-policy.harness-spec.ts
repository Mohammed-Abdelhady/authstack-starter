import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { ConfigService } from '@nestjs/config';
import { ROLE_AUDIENCE } from '../../host/types/host-role.type';
import { AccountCreationPolicy } from '../../auth/services/registration/account-creation-policy';
import type { OAuthService } from '../../auth/oauth/oauth.service';
import { refusalOf } from '../../../test/utils/user/accounts-contract/accounts-contract-support';
import {
  profileOf,
  type LinkedAccountsContractHarness,
  type LinkedHarnessSource,
} from './linked-accounts-contract.harness-spec';

const EMAIL = 'provider-policy-new@example.test';
const GOOGLE = { id: 'google', autoLinksByEmail: true };

type ProviderServices = (
  harness: LinkedAccountsContractHarness,
  policy: AccountCreationPolicy,
  config: ConfigService,
) => OAuthService;

export function providerCreationPolicyCases(
  harness: LinkedHarnessSource,
  services: ProviderServices,
): void {
  // Failure: stale process config overrides the audience read in the creation UOW.
  it.each([
    {
      name: 'stored customer with absent local setting',
      stored: 'customer',
      other: undefined,
      local: undefined,
      expected: 'customer',
    },
    {
      name: 'unrestricted app while another stored app names an audience',
      stored: undefined,
      other: 'customer',
      local: undefined,
      expected: 'customer',
    },
    {
      name: 'no stored audience despite a stale local setting',
      stored: undefined,
      other: undefined,
      local: 'customer',
      expected: undefined,
    },
    {
      name: 'fully dormant audiences',
      stored: undefined,
      other: undefined,
      local: undefined,
      expected: undefined,
    },
  ] as const)(
    'persists provider creation audience for $name',
    async ({ stored, other, local, expected }) => {
      const h = harness();
      await h.alterRoleAudience('user', 'customer');
      await h.configureCreationApplication(WEB_CLIENT_ID, {
        audience: stored,
      });
      await h.configureCreationApplication(ADMIN_CLIENT_ID, {
        audience: other,
      });
      const config = new ConfigService({
        auth: { web: { signIn: { audience: local } } },
      });
      const service = services(
        h,
        new AccountCreationPolicy(h.issuanceApplications),
        config,
      );
      const created = await service.findOrCreateUser(
        GOOGLE,
        profileOf('audience-provider', { email: EMAIL }),
      );
      expect((await h.account(created.id))?.audience).toBe(expected);
    },
  );

  // Failure: closed self sign-up bypasses policy through provider creation.
  it.each([ROLE_AUDIENCE.CUSTOMER, ROLE_AUDIENCE.STAFF])(
    'writes no provider account for closed %s self sign-up',
    async (audience) => {
      const h = harness();
      await h.alterRoleAudience('user', ROLE_AUDIENCE.CUSTOMER);
      await h.configureCreationApplication(WEB_CLIENT_ID, {
        audience,
        signUp: 'closed',
      });
      const config = new ConfigService({
        auth: { web: { signIn: { audience, signUp: 'closed' } } },
      });
      const service = services(
        h,
        new AccountCreationPolicy(h.issuanceApplications),
        config,
      );
      expect(
        await refusalOf(
          service.findOrCreateUser(
            GOOGLE,
            profileOf('closed-provider', { email: EMAIL }),
          ),
        ),
      ).toEqual({ code: 'OAUTH_AUTHENTICATION_FAILED', status: 401 });
      expect(await h.accountIdByEmail(EMAIL)).toBeNull();
      expect(await h.claims()).toEqual([]);
    },
  );

  // Failure: provider creation stores a customer with an unmapped or staff role.
  it.each([undefined, ROLE_AUDIENCE.STAFF])(
    'rolls provider creation back for default-role audience %s',
    async (roleAudience) => {
      const h = harness();
      if (roleAudience) await h.alterRoleAudience('user', roleAudience);
      await h.configureCreationApplication(WEB_CLIENT_ID, {
        audience: ROLE_AUDIENCE.CUSTOMER,
        signUp: 'open',
      });
      const config = new ConfigService({
        auth: { web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } } },
      });
      const service = services(
        h,
        new AccountCreationPolicy(h.issuanceApplications),
        config,
      );
      expect(
        await refusalOf(
          service.findOrCreateUser(
            GOOGLE,
            profileOf('parity-provider', { email: EMAIL }),
          ),
        ),
      ).toEqual({ code: 'OAUTH_AUTHENTICATION_FAILED', status: 401 });
      expect(await h.accountIdByEmail(EMAIL)).toBeNull();
      expect(await h.claims()).toEqual([]);
    },
  );
}
