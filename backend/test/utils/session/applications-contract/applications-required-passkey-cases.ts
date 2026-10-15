import { ConfigService } from '@nestjs/config';
import { AuthEpochService } from '../../../../src/common/services/auth-epoch.service';
import { BrowserApplications } from '../../../../src/session/applications/browser-applications';
import { BrowserPolicyReconciler } from '../../../../src/session/applications/browser-policy-reconciler';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import { CONTRACT_ENVIRONMENT } from '../issuance-contract/issuance-contract-harness';
import {
  type ApplicationsHarnessSource,
  CLIENT_ORIGIN,
  MOBILE,
  OTHER_ENVIRONMENT,
  nativeApplication,
  registryOn,
} from './applications-contract-support';

export function requiredPasskeyStartupCases(
  harness: ApplicationsHarnessSource,
): void {
  // Failure: stored requirements outside the configured client list bypass startup.
  it.each([
    {
      platform: APPLICATION_PLATFORM.NATIVE,
      clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
      enabled: true,
    },
    {
      platform: APPLICATION_PLATFORM.WEB,
      clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
      enabled: false,
    },
    {
      platform: APPLICATION_PLATFORM.ADMIN,
      clientType: APPLICATION_CLIENT_TYPE.CONFIDENTIAL,
      enabled: false,
    },
  ])(
    'refuses an unconfigured stored $platform requirement with enabled=$enabled',
    async ({ platform, clientType, enabled }) => {
      const h = harness();
      const registry = registryOn(h, { nativeEnabled: false });
      expect(
        await h.registryStore.findRequiredPasskeyApplication(
          CONTRACT_ENVIRONMENT,
        ),
      ).toBeNull();
      await registry.reconcileNativeApplications();
      await h.seedStoredApplication(
        nativeApplication({
          clientId: 'unconfigured-required',
          requirePasskey: true,
          platform,
          clientType,
          enabled,
        }),
      );
      expect(
        await h.registryStore.findRequiredPasskeyApplication(
          CONTRACT_ENVIRONMENT,
        ),
      ).toBe('unconfigured-required');
      await expect(registry.reconcileNativeApplications()).rejects.toThrow(
        /unconfigured-required.*plan 3.*passkey sign-in evidence/,
      );
      await h.clearApplicationPolicy('unconfigured-required');
      await registry.reconcileNativeApplications();
      expect(
        await h.registryStore.findRequiredPasskeyApplication(
          CONTRACT_ENVIRONMENT,
        ),
      ).toBeNull();
    },
  );

  // Failure: another environment's requirement blocks a healthy installation.
  it('ignores absent, false and other-environment requirements', async () => {
    const h = harness();
    await h.seedStoredApplication(
      nativeApplication({
        clientId: 'foreign-required',
        environment: OTHER_ENVIRONMENT,
        requirePasskey: true,
      }),
    );
    await h.seedStoredApplication(nativeApplication({ requirePasskey: false }));
    expect(
      await h.registryStore.findRequiredPasskeyApplication(
        CONTRACT_ENVIRONMENT,
      ),
    ).toBeNull();
    await registryOn(h, { nativeEnabled: false }).reconcileNativeApplications();
    expect(
      await h.registryStore.findRequiredPasskeyApplication(OTHER_ENVIRONMENT),
    ).toBe('foreign-required');
  });

  // Failure: native ConfigService overrides activate a requirement after env validation.
  it('refuses configured native requirements before creating their application', async () => {
    const h = harness();
    await expect(
      registryOn(h, {
        nativeApplications: [{ ...MOBILE, requirePasskey: true }],
      }).reconcileNativeApplications(),
    ).rejects.toThrow(/configured-mobile.*plan 3.*passkey sign-in evidence/);
    expect(await registryOn(h).findByClientId(MOBILE.clientId)).toBeNull();
  });

  // Failure: browser ConfigService overrides commit a policy that cannot be enforced yet.
  it.each([WEB_CLIENT_ID, ADMIN_CLIENT_ID])(
    'refuses configured %s requirements before changing stored policy',
    async (clientId) => {
      const h = harness();
      const before = await registryOn(h).findByClientId(clientId);
      const config = new ConfigService({
        server: { nodeEnv: 'test' },
        cors: {
          clientUrl: CLIENT_ORIGIN,
          adminUrl: 'https://admin.example.test',
        },
        auth: { [clientId]: { signIn: { requirePasskey: true } } },
      });
      const reconciler = new BrowserPolicyReconciler(
        h.authority.issuance.runner(rerunAtOnce),
        h.registryStore,
        new BrowserApplications(config, () => Promise.resolve(true)),
        new AuthEpochService(config),
        h.recorder,
        config,
      );
      await expect(reconciler.reconcile()).rejects.toThrow(
        new RegExp(`${clientId}.*plan 3.*passkey sign-in evidence`),
      );
      expect(await registryOn(h).findByClientId(clientId)).toEqual(before);
    },
  );
}
