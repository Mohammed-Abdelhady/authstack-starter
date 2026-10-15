import {
  ADMIN_CLIENT_ID,
  APPLICATION_PLATFORM,
  WEB_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import type { BrowserRegistration } from '../../../../src/session/applications/types/browser-registration';
import { RetryableAbortError } from '../../../../src/common/persistence/persistence-errors';
import { ConfigService } from '@nestjs/config';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import {
  ApplicationsHarnessSource,
  browserReconcilerOn,
  CLIENT_ORIGIN,
  registryOn,
} from './applications-contract-support';

function configuration(): ConfigService {
  return new ConfigService({
    auth: { web: { enabled: true, enabledExplicit: false } },
    cors: { clientUrl: CLIENT_ORIGIN },
    server: { nodeEnv: 'test' },
    ADMIN_URL: '',
    AUTH_WEB_SIGN_IN: '',
    AUTH_ADMIN_SIGN_IN: '',
  });
}

export function browserPolicyReconcileCases(
  harness: ApplicationsHarnessSource,
): void {
  const reconciler = (config: ConfigService) =>
    browserReconcilerOn(harness(), config);
  const web = () => registryOn(harness()).requireEnabled(WEB_CLIENT_ID);
  const events = async () =>
    (await harness().authority.events()).filter(
      ({ action }) => action === 'policy_changed',
    );

  // Failure: restarts invalidate sessions despite unchanged effective policy.
  it('restores default lifetimes and keeps versions across restarts and explicit default methods', async () => {
    const config = configuration();
    await reconciler(config).reconcile();
    config.set('auth.web.signIn', { password: true });
    await reconciler(config).reconcile();
    expect({
      version: (await web()).policyVersion,
      limits: (await web()).policy,
      events: await events(),
    }).toEqual({
      version: 0,
      limits: {
        absoluteLifetimeMs: 604_800_000,
        idleLifetimeMs: 1_800_000,
        unboundAbsoluteLifetimeMs: undefined,
        unboundIdleLifetimeMs: undefined,
      },
      events: [],
    });
  });

  // feature:email-code:start
  // Failure: a reserved flag ends browser sessions without enforcing a method rule.
  it('keeps reserved emailCode out of the snapshot and policy version', async () => {
    const config = configuration();
    for (const emailCode of [false, true]) {
      config.set('auth.web.signIn', { emailCode });
      await reconciler(config).reconcile();
      const application = await web();
      expect({
        version: application.policyVersion,
        methods: application.signInMethods,
        events: await events(),
      }).toEqual({ version: 0, methods: {}, events: [] });
    }
  });
  // feature:email-code:end

  // Failure: tightening policy leaves old sessions usable or records duplicate transitions.
  it('advances and records once per real change, including removal of audience policy', async () => {
    const config = configuration();
    config.set('auth.web.signIn', {
      signUp: 'closed',
      audience: 'customer',
      password: false,
    });
    const reconcile = reconciler(config);
    await reconcile.reconcile();
    await reconcile.reconcile();
    expect({
      version: (await web()).policyVersion,
      audience: (await web()).accountAudience,
      actions: (await events()).map(({ action, clientId }) => [
        action,
        clientId,
      ]),
    }).toEqual({
      version: 1,
      audience: 'customer',
      actions: [['policy_changed', WEB_CLIENT_ID]],
    });
    config.set('auth.web.signIn', undefined);
    await reconcile.reconcile();
    const restored = await web();
    expect({
      version: restored.policyVersion,
      audience: restored.accountAudience ?? null,
      signUp: restored.signUp,
      methods: restored.signInMethods,
      count: (await events()).length,
    }).toEqual({
      version: 2,
      audience: null,
      signUp: 'open',
      methods: null,
      count: 2,
    });
  });

  // Failure: an absent setting silently reenables a manually disabled application.
  it('preserves a manual disable until the enabled setting is explicit', async () => {
    const current = harness();
    await current.authority.issuance
      .runner(rerunAtOnce)
      .run((work) =>
        current.accessStore.disableApplication(work, 'test', WEB_CLIENT_ID),
      );
    const config = configuration();
    await reconciler(config).reconcile();
    expect(
      (
        await current.registryStore.readCommittedApplication(
          'test',
          WEB_CLIENT_ID,
        )
      )?.enabled,
    ).toBe(false);
    config.set('auth.web.enabledExplicit', true);
    await reconciler(config).reconcile();
    expect(
      (
        await current.registryStore.readCommittedApplication(
          'test',
          WEB_CLIENT_ID,
        )
      )?.enabled,
    ).toBe(true);
    config.set('auth.web.enabled', false);
    await reconciler(config).reconcile();
    expect(
      (
        await current.registryStore.readCommittedApplication(
          'test',
          WEB_CLIENT_ID,
        )
      )?.enabled,
    ).toBe(false);
  });

  // Failure: policy changes commit even though their mandatory event failed to persist.
  it('rolls back the policy version and snapshot when recording fails', async () => {
    const config = configuration();
    const before = await web();
    config.set('auth.web.signIn', { password: false });
    const restore = await harness().authority.issuance.refuseSecurityEvents();
    try {
      await expect(reconciler(config).reconcile()).rejects.toBeInstanceOf(
        Error,
      );
    } finally {
      restore();
    }
    expect({ application: await web(), events: await events() }).toEqual({
      application: before,
      events: [],
    });
  });

  // Failure: a stale writer overwrites another process's already committed policy.
  it('refuses a stale expected policy version without changing the committed snapshot', async () => {
    const current = harness();
    const registration: BrowserRegistration = {
      clientId: WEB_CLIENT_ID,
      environment: 'test',
      displayName: 'Web',
      platform: APPLICATION_PLATFORM.WEB,
      clientType: 'public',
      allowedOrigins: [CLIENT_ORIGIN],
      initialAudiences: ['api'],
      initialScopes: ['api'],
      policy: { absoluteLifetimeMs: 7_200_000, idleLifetimeMs: 600_000 },
      signUp: 'closed',
      requirePasskey: false,
      accountAudience: null,
      signInMethods: { password: false },
      expectedPolicyVersion: 0,
      policyVersion: 1,
    };
    await current.authority.issuance.runner(rerunAtOnce).run(async (work) => {
      await current.registryStore.takeRegistrations(work, 'test', [
        WEB_CLIENT_ID,
      ]);
      await current.registryStore.storeBrowserRegistration(work, registration);
    });
    await expect(
      current.authority.issuance.runner(rerunAtOnce).run((work) =>
        current.registryStore.storeBrowserRegistration(work, {
          ...registration,
          signUp: 'open',
          policyVersion: 2,
        }),
      ),
    ).rejects.toBeInstanceOf(RetryableAbortError);
    expect(await web()).toMatchObject({
      signUp: 'closed',
      policyVersion: 1,
      signInMethods: { password: false },
    });
  });

  // Failure: production never registers browser applications, or rewrites the legacy admin row.
  it('creates production web policy at version zero and leaves absent admin configuration alone', async () => {
    const current = harness();
    const beforeAdmin = await current.registryStore.readCommittedApplication(
      'test',
      ADMIN_CLIENT_ID,
    );
    const config = configuration();
    await reconciler(config).reconcile();
    expect(
      await current.registryStore.readCommittedApplication(
        'test',
        ADMIN_CLIENT_ID,
      ),
    ).toEqual(beforeAdmin);
    config.set('server.nodeEnv', 'production');
    await reconciler(config).reconcile();
    expect(
      await current.registryStore.readCommittedApplication(
        'production',
        WEB_CLIENT_ID,
      ),
    ).toMatchObject({
      clientId: WEB_CLIENT_ID,
      enabled: true,
      policyVersion: 0,
      signUp: 'open',
    });
    expect(
      await current.registryStore.readCommittedApplication(
        'production',
        ADMIN_CLIENT_ID,
      ),
    ).toBeNull();
    expect(await events()).toEqual([]);
  });
}
