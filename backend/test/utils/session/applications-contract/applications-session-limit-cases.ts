import { ConfigService } from '@nestjs/config';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import {
  type ApplicationsHarnessSource,
  browserReconcilerOn,
  CLIENT_ORIGIN,
  eventsFor,
  MOBILE,
  MOBILE_CLIENT,
  reconcile,
  registryOn,
} from './applications-contract-support';

function configuration() {
  return new ConfigService({
    server: { nodeEnv: 'test' },
    cors: { clientUrl: CLIENT_ORIGIN, adminUrl: 'https://admin.example.test' },
  });
}

export function applicationSessionLimitCases(
  harness: ApplicationsHarnessSource,
): void {
  // Failure: live limit edits either are lost at startup or invalidate every session by advancing policy version.
  it.each([
    { clientId: WEB_CLIENT_ID, absolute: 604_800_000, idle: 1_800_000 },
    { clientId: ADMIN_CLIENT_ID, absolute: 28_800_000, idle: 900_000 },
  ])(
    'restores $clientId session defaults on removal without advancing versions',
    async ({ clientId, absolute, idle }) => {
      const h = harness();
      const config = configuration();
      config.set(`auth.${clientId}.session`, {
        absoluteHours: 3,
        idleMinutes: 7,
        cap: 2,
      });
      const reconcileBrowser = browserReconcilerOn(h, config);
      await reconcileBrowser.reconcile();
      const read = () => registryOn(h).requireEnabled(clientId);
      expect(await read()).toMatchObject({
        policy: { absoluteLifetimeMs: 10_800_000, idleLifetimeMs: 420_000 },
        sessionCap: 2,
        policyVersion: 0,
        sessionVersion: 0,
      });
      config.set(`auth.${clientId}.session`, {
        absoluteHours: 4,
        idleMinutes: 8,
        cap: 3,
      });
      await reconcileBrowser.reconcile();
      config.set(`auth.${clientId}.session`, undefined);
      await reconcileBrowser.reconcile();
      const removed = await read();
      expect({
        policy: removed.policy,
        cap: removed.sessionCap,
        version: removed.policyVersion,
        sessions: removed.sessionVersion,
      }).toEqual({
        policy: {
          absoluteLifetimeMs: absolute,
          idleLifetimeMs: idle,
          unboundAbsoluteLifetimeMs: undefined,
          unboundIdleLifetimeMs: undefined,
        },
        cap: undefined,
        version: 0,
        sessions: 0,
      });
      expect(await eventsFor(h, clientId)).toEqual([]);
    },
  );

  // Failure: the Mongo insertion path omits a configured cap while the update path stores it.
  it('stores configured session policy when startup creates a browser row', async () => {
    const h = harness();
    const config = configuration();
    config.set('server.nodeEnv', 'production');
    config.set('auth.web.session', {
      absoluteHours: 2,
      idleMinutes: 4,
      cap: 2,
    });
    await browserReconcilerOn(h, config).reconcile();
    expect(
      await h.registryStore.readCommittedApplication(
        'production',
        WEB_CLIENT_ID,
      ),
    ).toMatchObject({
      sessionCap: 2,
      policy: { absoluteLifetimeMs: 7_200_000, idleLifetimeMs: 240_000 },
    });
  });

  // Failure: a ConfigService override bypasses environment validation of admin ceilings.
  it('refuses an above-bound admin setting before reconciliation writes', async () => {
    const h = harness();
    const before = await registryOn(h).findByClientId(WEB_CLIENT_ID);
    const config = configuration();
    config.set('auth.admin.session', {
      absoluteHours: 8,
      idleMinutes: 16,
      cap: 5,
    });
    await expect(browserReconcilerOn(h, config).reconcile()).rejects.toThrow(
      /AUTH_ADMIN_SESSION/,
    );
    expect(await registryOn(h).findByClientId(WEB_CLIENT_ID)).toEqual(before);
  });

  // Failure: native startup leaves stale unbound fields behind or bumps sessions for a live limit edit.
  it('reconciles bound and unbound pairs and restores defaults without advancing versions', async () => {
    const h = harness();
    const configured = {
      ...MOBILE,
      session: {
        bound: { absoluteHours: 24, idleMinutes: 60 },
        unbound: { absoluteHours: 2, idleMinutes: 3 },
      },
    };
    await reconcile(h, [configured]);
    const read = () => registryOn(h).requireEnabled(MOBILE_CLIENT);
    expect(await read()).toMatchObject({
      sessionVersion: 0,
      policyVersion: 0,
      policy: {
        absoluteLifetimeMs: 86_400_000,
        idleLifetimeMs: 3_600_000,
        unboundAbsoluteLifetimeMs: 7_200_000,
        unboundIdleLifetimeMs: 180_000,
      },
    });
    await reconcile(h, [
      {
        ...configured,
        session: {
          bound: { absoluteHours: 12, idleMinutes: 30 },
          unbound: { absoluteHours: 1, idleMinutes: 1 },
        },
      },
    ]);
    expect(await read()).toMatchObject({
      sessionVersion: 0,
      policyVersion: 0,
      policy: {
        absoluteLifetimeMs: 43_200_000,
        idleLifetimeMs: 1_800_000,
        unboundAbsoluteLifetimeMs: 3_600_000,
        unboundIdleLifetimeMs: 60_000,
      },
    });
    await reconcile(h, [MOBILE]);
    const restored = await read();
    expect({
      policy: restored.policy,
      version: restored.sessionVersion,
    }).toEqual({
      policy: {
        absoluteLifetimeMs: 2_592_000_000,
        idleLifetimeMs: 604_800_000,
        unboundAbsoluteLifetimeMs: undefined,
        unboundIdleLifetimeMs: undefined,
      },
      version: 0,
    });
    expect(await eventsFor(h, MOBILE_CLIENT)).toEqual([]);
  });

  // Failure: an unbound session outlives its device-bound counterpart.
  it.each([
    { field: 'absoluteHours', unbound: { absoluteHours: 25, idleMinutes: 5 } },
    { field: 'idleMinutes', unbound: { absoluteHours: 1, idleMinutes: 31 } },
  ])(
    'refuses a longer unbound $field before any registry write',
    async ({ field, unbound }) => {
      const h = harness();
      await reconcile(h, [MOBILE]);
      const before = await registryOn(h).requireEnabled(MOBILE_CLIENT);
      await expect(
        reconcile(h, [
          {
            ...MOBILE,
            session: {
              bound: { absoluteHours: 24, idleMinutes: 30 },
              unbound,
            },
          },
        ]),
      ).rejects.toThrow(
        new RegExp(
          `AUTH_NATIVE_APPLICATIONS.*${MOBILE_CLIENT}.*unbound.${field}.*reduce`,
        ),
      );
      expect(await registryOn(h).requireEnabled(MOBILE_CLIENT)).toEqual(before);
      expect(await eventsFor(h, MOBILE_CLIENT)).toEqual([]);
    },
  );

  it('persists equal native bound and unbound limits', async () => {
    const h = harness();
    await reconcile(h, [
      {
        ...MOBILE,
        session: {
          bound: { absoluteHours: 2, idleMinutes: 3 },
          unbound: { absoluteHours: 2, idleMinutes: 3 },
        },
      },
    ]);
    expect(await registryOn(h).requireEnabled(MOBILE_CLIENT)).toMatchObject({
      policy: {
        absoluteLifetimeMs: 7_200_000,
        idleLifetimeMs: 180_000,
        unboundAbsoluteLifetimeMs: 7_200_000,
        unboundIdleLifetimeMs: 180_000,
      },
      policyVersion: 0,
      sessionVersion: 0,
    });
  });
}
