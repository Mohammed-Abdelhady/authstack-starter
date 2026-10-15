import { SIGN_UP_POLICY } from '../../../../src/config/constants/host-contracts';
import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { ROLE_AUDIENCE } from '../../../../src/host/types/host-role.type';
import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { createResponseMock } from '../../../../src/common/testing/test-doubles.harness-spec';
import {
  AccountsHarnessSource,
  DEFAULT_SLUG,
  configurationForAccounts,
  configureCreationApplications,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

// Catches creation losing audience or backfilling it in dormant deployments.
export function accountActivationAudienceCases(
  harness: AccountsHarnessSource,
): void {
  it.each([
    {
      name: 'stored customer with no process audience',
      storedAuth: {
        web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } },
      },
      processAuth: {},
      expected: 'customer',
    },
    {
      name: 'stored unrestricted web while another application names staff',
      storedAuth: {
        admin: {
          signIn: { audience: ROLE_AUDIENCE.STAFF, signUp: 'closed' },
        },
      },
      processAuth: {},
      expected: 'customer',
    },
    {
      name: 'no stored audience despite stale process customer policy',
      storedAuth: {},
      processAuth: {
        web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } },
      },
      expected: undefined,
    },
  ])(
    'persists the creation audience for $name',
    async ({ storedAuth, processAuth, expected }) => {
      const h = harness();
      await h.alterRoleAudience(DEFAULT_SLUG, ROLE_AUDIENCE.CUSTOMER);
      await configureCreationApplications(
        h,
        configurationForAccounts(storedAuth),
      );
      const services = servicesOn(
        h,
        undefined,
        undefined,
        configurationForAccounts(processAuth),
      );
      const email = 'activation-audience@example.test';
      const pending =
        await services.verification.createOrUpdatePendingRegistration(
          email,
          PENDING_PURPOSE.SIGNUP,
        );
      if (!pending) throw new Error('sign-up code was not issued');
      await services.registration.activate(
        {
          email,
          code: pending.code,
          password: 'AudiencePassword1!',
          name: 'Audience Tester',
        },
        createResponseMock({}),
        'en',
      );
      const id = await h.accountIdByEmail(email);
      expect(id).not.toBeNull();
      const stored = await storedAccount(h, id ?? '');
      expect({ audience: stored.audience, role: stored.role }).toEqual({
        audience: expected,
        role: 'user',
      });
      expect(await h.pendingRegistrations(email)).toBe(0);
    },
  );

  // A stored close must stop an old process without losing the activation code.
  it('reads a changed stored sign-up policy through the same service before creation', async () => {
    const h = harness();
    await h.alterRoleAudience(DEFAULT_SLUG, ROLE_AUDIENCE.CUSTOMER);
    const config = configurationForAccounts({
      web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } },
    });
    await configureCreationApplications(h, config);
    const services = servicesOn(h, undefined, undefined, config);
    const email = 'stored-policy-activation@example.test';
    const pending =
      await services.verification.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.SIGNUP,
      );
    if (!pending) throw new Error('sign-up code was not issued');
    const dto = {
      email,
      code: pending.code,
      password: 'AudiencePassword1!',
      name: 'Stored Policy Tester',
    };
    await h.configureCreationApplication(WEB_CLIENT_ID, {
      signUp: SIGN_UP_POLICY.CLOSED,
      audience: ROLE_AUDIENCE.CUSTOMER,
    });

    await expect(
      services.registration.activate(dto, createResponseMock({}), 'en'),
    ).rejects.toMatchObject({ code: 'ACTIVATION_CODE_INVALID', status: 400 });
    expect(await h.accountIdByEmail(email)).toBeNull();
    expect(await h.pendingRegistrations(email)).toBe(1);
    expect(await h.claims()).toEqual([]);

    await h.configureCreationApplication(WEB_CLIENT_ID, {
      signUp: SIGN_UP_POLICY.OPEN,
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    await services.registration.activate(dto, createResponseMock({}), 'en');
    const id = await h.accountIdByEmail(email);
    expect(id).not.toBeNull();
    expect(await storedAccount(h, id ?? '')).toMatchObject({
      audience: ROLE_AUDIENCE.CUSTOMER,
      role: DEFAULT_SLUG,
    });
    expect(await h.pendingRegistrations(email)).toBe(0);
  });

  // Failure: the default role and created account disagree after activation commits.
  it.each([undefined, ROLE_AUDIENCE.STAFF])(
    'retains its code and writes no account for default-role audience %s',
    async (roleAudience) => {
      const h = harness();
      if (roleAudience) await h.alterRoleAudience(DEFAULT_SLUG, roleAudience);
      const config = configurationForAccounts({
        web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } },
      });
      await configureCreationApplications(h, config);
      const services = servicesOn(h, undefined, undefined, config);
      const email = 'activation-parity@example.test';
      const issued =
        await services.verification.createOrUpdatePendingRegistration(
          email,
          PENDING_PURPOSE.SIGNUP,
        );
      if (!issued) throw new Error('sign-up code was not issued');
      const refused = services.registration.activate(
        {
          email,
          code: issued.code,
          password: 'AudiencePassword1!',
          name: 'Parity Tester',
        },
        createResponseMock({}),
        'en',
      );
      await expect(refused).rejects.toMatchObject({
        code: 'ACTIVATION_CODE_INVALID',
        status: 400,
      });
      expect(await h.accountIdByEmail(email)).toBeNull();
      expect(await h.pendingRegistrations(email)).toBe(1);
      expect(await h.claims()).toEqual([]);
    },
  );
}
