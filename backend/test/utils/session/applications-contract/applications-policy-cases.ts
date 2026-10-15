import {
  ADMIN_CLIENT_ID, // feature:passkeys
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import { ConfigService } from '@nestjs/config'; // feature:passkeys
import type { IssuanceApplication } from '../../../../src/session/issuance/browser-issuance.store';
import {
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  applicationPolicyOn,
  ApplicationsHarnessSource,
  MOBILE_CLIENT,
  nativeApplication,
  registryOn,
} from './applications-contract-support';

function policyOf(application: IssuanceApplication | null) {
  return {
    signUp: application?.signUp,
    requirePasskey: application?.requirePasskey,
    signInMethods: application?.signInMethods,
    accountAudience: application?.accountAudience,
    policyVersion: application?.policyVersion,
    sessionCap: application?.sessionCap,
    unboundAbsoluteLifetimeMs: application?.policy.unboundAbsoluteLifetimeMs,
    unboundIdleLifetimeMs: application?.policy.unboundIdleLifetimeMs,
  };
}

const STORED_POLICY = {
  signUp: 'closed',
  requirePasskey: true,
  signInMethods: { password: false, passkeys: true },
  accountAudience: 'staff',
  policyVersion: 7,
  sessionCap: 3,
  unboundAbsoluteLifetimeMs: 3_600_000,
  unboundIdleLifetimeMs: 60_000,
};

export function applicationPolicyCases(
  harness: ApplicationsHarnessSource,
): void {
  it('reads missing application policy as open, unrestricted and without a method snapshot', async () => {
    await harness().clearApplicationPolicy(WEB_CLIENT);
    const policy = await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run((work) =>
        applicationPolicyOn(harness()).requireEnabled(work, WEB_CLIENT),
      );
    expect({
      signUp: policy.signUp,
      requirePasskey: policy.requirePasskey,
      accountAudience: policy.accountAudience ?? null,
      signInMethods: policy.signInMethods,
    }).toEqual({
      signUp: 'open',
      requirePasskey: false,
      accountAudience: null,
      signInMethods: null,
    });
  });

  it('carries stored admission policy through registry, issuance and authority reads', async () => {
    await harness().seedStoredApplication(
      nativeApplication({
        signUp: 'closed',
        requirePasskey: true,
        signInMethods: { password: false, passkeys: true },
        accountAudience: 'staff',
        policyVersion: 7,
        sessionCap: 3,
        unboundAbsoluteLifetimeMs: 3_600_000,
        unboundIdleLifetimeMs: 60_000,
      }),
    );
    const registry = registryOn(harness());
    const issuance = harness().authority.issuance;
    const committed = await registry.requireEnabled(MOBILE_CLIENT);
    const client = await registry.lookUpClient(MOBILE_CLIENT);
    const authority =
      await harness().authority.authorityApplications.findByClientId(
        MOBILE_CLIENT,
      );
    const transactional = await issuance
      .runner(rerunAtOnce)
      .run(async (work) => [
        policyOf(await registry.requireEnabledIn(work, MOBILE_CLIENT)),
        policyOf(
          await issuance.applications.requireEnabled(work, MOBILE_CLIENT),
        ),
        policyOf(await registry.findClientIn(work, MOBILE_CLIENT)),
        policyOf(
          await applicationPolicyOn(harness()).requireEnabled(
            work,
            MOBILE_CLIENT,
          ),
        ),
      ]);
    expect([
      policyOf(committed),
      policyOf(client),
      policyOf(authority),
      ...transactional,
    ]).toEqual(Array.from({ length: 7 }, () => STORED_POLICY));
  });

  it('persists explicit policy without changing it when a legacy registration omits it', async () => {
    const store = harness().registryStore;
    const registration = {
      clientId: WEB_CLIENT,
      environment: 'test',
      displayName: 'Web',
      platform: APPLICATION_PLATFORM.WEB,
      clientType: 'public',
      allowedOrigins: [],
      initialAudiences: ['api'],
      initialScopes: ['api'],
      policy: { absoluteLifetimeMs: 7_200_000, idleLifetimeMs: 600_000 },
    };
    await store.registerFirstParty({
      ...registration,
      signUp: 'closed',
      requirePasskey: true,
      signInMethods: { password: false, passkeys: true },
      accountAudience: 'staff',
      policyVersion: 7,
      sessionCap: 3,
      policy: {
        ...registration.policy,
        unboundAbsoluteLifetimeMs: 3_600_000,
        unboundIdleLifetimeMs: 60_000,
      },
    });
    await store.registerFirstParty(registration);

    expect(
      policyOf(await registryOn(harness()).requireEnabled(WEB_CLIENT)),
    ).toEqual(STORED_POLICY);
    expect(
      (await harness().storedApplications()).find(
        ({ clientId }) => clientId === WEB_CLIENT,
      )?.audiences,
    ).toEqual(['api']);

    const issuance = harness().authority.issuance;
    const userId = await issuance.seedAccount();
    await issuance
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        'Contract/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT_ID,
      );
    const candidates = await issuance.runner(rerunAtOnce).run((work) =>
      issuance.store.listSessionCapCandidates(work, {
        userId,
        userVersion: 0,
        authEpoch: 1,
        now: issuance.clock.now(),
        purposes: ['browser_session'],
      }),
    );
    expect(candidates.map(({ application }) => policyOf(application))).toEqual([
      STORED_POLICY,
    ]);

    await store.registerFirstParty({ ...registration, signInMethods: null });
    const cleared = await registryOn(harness()).requireEnabled(WEB_CLIENT);
    expect({
      methods: cleared.signInMethods,
      version: cleared.policyVersion,
    }).toEqual({
      methods: null,
      version: 7,
    });
    await store.registerFirstParty({ ...registration, signInMethods: {} });
    expect(
      (await registryOn(harness()).requireEnabled(WEB_CLIENT)).signInMethods,
    ).toEqual({});
  });

  it('persists native registration policy and preserves its account audience', async () => {
    await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run(async (work) => {
        await harness().registryStore.takeRegistrations(work, 'test', [
          MOBILE_CLIENT,
        ]);
        await harness().registryStore.storeNativeRegistration(work, {
          clientId: MOBILE_CLIENT,
          environment: 'test',
          displayName: 'Mobile',
          redirectUris: ['example-native://callback'],
          allowedScopes: ['api'],
          audiences: ['api'],
          endsSessions: false,
          signUp: 'closed',
          requirePasskey: true,
          signInMethods: { password: false, passkeys: true },
          accountAudience: 'staff',
          policyVersion: 7,
          sessionCap: 3,
          policy: {
            absoluteLifetimeMs: 7_200_000,
            idleLifetimeMs: 600_000,
            unboundAbsoluteLifetimeMs: 3_600_000,
            unboundIdleLifetimeMs: 60_000,
          },
        });
        const stored = await harness().registryStore.takeRegistrations(
          work,
          'test',
          [MOBILE_CLIENT],
        );
        expect(stored).toMatchObject([
          {
            signInMethods: { password: false, passkeys: true },
            policyVersion: 7,
          },
        ]);
      });

    expect(
      policyOf(await registryOn(harness()).requireEnabled(MOBILE_CLIENT)),
    ).toEqual(STORED_POLICY);
  });

  it.each([
    { unboundAbsoluteLifetimeMs: 3_600_000 },
    { unboundIdleLifetimeMs: 60_000 },
    { unboundAbsoluteLifetimeMs: 0, unboundIdleLifetimeMs: 60_000 },
    { unboundAbsoluteLifetimeMs: -1, unboundIdleLifetimeMs: 60_000 },
  ])('refuses incomplete or nonpositive unbound limits %p', async (limits) => {
    await expect(
      harness().seedStoredApplication(nativeApplication(limits)),
    ).rejects.toThrow();
    expect(
      await registryOn(harness()).findByClientId(MOBILE_CLIENT),
    ).toBeNull();
  });

  // feature:passkeys:start
  it('reads web overrides and the admin URL as separate relying parties', async () => {
    const reader = applicationPolicyOn(
      harness(),
      new ConfigService({
        passkeys: {
          enabled: true,
          rpId: 'credentials.example.test',
          origin: 'https://web.example.test:8443',
        },
        cors: { adminUrl: 'https://admin.example.test:9443/console' },
      }),
    );
    const parties = await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run(async (work) => [
        (await reader.requireEnabled(work, WEB_CLIENT)).passkeyRelyingParty,
        (await reader.requireEnabled(work, ADMIN_CLIENT_ID))
          .passkeyRelyingParty,
      ]);
    expect(parties).toEqual([
      {
        rpId: 'credentials.example.test',
        origins: ['https://web.example.test:8443'],
      },
      {
        rpId: 'admin.example.test',
        origins: ['https://admin.example.test:9443'],
      },
    ]);
  });

  it('uses native signIn rather than the stored browser method snapshot', async () => {
    await harness().seedStoredApplication(
      nativeApplication({ signInMethods: { passkeys: false } }),
    );
    const reader = applicationPolicyOn(
      harness(),
      new ConfigService({
        auth: {
          nativeApplications: [
            {
              clientId: MOBILE_CLIENT,
              signIn: {
                passkeys: true,
                rpId: 'native.example.test',
                origins: ['https://native.example.test'],
              },
            },
          ],
        },
      }),
    );
    const policy = await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run((work) => reader.requireEnabled(work, MOBILE_CLIENT));
    expect(policy.passkeyRelyingParty).toEqual({
      rpId: 'native.example.test',
      origins: ['https://native.example.test'],
    });
  });

  it('has no relying party when passkeys are unavailable or the admin URL is absent', async () => {
    await harness().seedStoredApplication(nativeApplication());
    const serverOff = applicationPolicyOn(
      harness(),
      new ConfigService({ passkeys: { enabled: false } }),
    );
    const webOff = applicationPolicyOn(
      harness(),
      new ConfigService({ auth: { web: { signIn: { passkeys: false } } } }),
    );
    const legacy = applicationPolicyOn(harness());
    const parties = await harness()
      .authority.issuance.runner(rerunAtOnce)
      .run(async (work) => [
        (await serverOff.requireEnabled(work, WEB_CLIENT)).passkeyRelyingParty,
        (await webOff.requireEnabled(work, WEB_CLIENT)).passkeyRelyingParty,
        (await legacy.requireEnabled(work, ADMIN_CLIENT_ID))
          .passkeyRelyingParty,
        (await legacy.requireEnabled(work, MOBILE_CLIENT)).passkeyRelyingParty,
      ]);
    expect(parties).toEqual([null, null, null, null]);
  });
  // feature:passkeys:end
}
