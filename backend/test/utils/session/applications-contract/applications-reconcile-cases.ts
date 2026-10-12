import type { NativeApplicationConfiguration } from '../../../../src/config/types/native-application.type';
import { failAfter } from '../authority-contract/authority-contract-support';
import { rejectionOf } from '../issuance-contract/issuance-contract-support';
import {
  ApplicationsHarnessSource,
  MOBILE,
  MOBILE_STORED,
  nativeApplication,
  OTHER_ENVIRONMENT,
  reconcile,
  registryOn,
  storedApplication,
  storedNatives,
} from './applications-contract-support';

const INTERRUPTED = 'the start was interrupted';
const SECOND_MOBILE: NativeApplicationConfiguration = {
  clientId: 'second-mobile',
  displayName: 'Second Mobile',
  redirectUris: ['second-native://callback'],
  allowedScopes: ['api'],
};

export function reconciliationCases(harness: ApplicationsHarnessSource): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  it('creates a listed application, enabled and at version 0', async () => {
    await reconcile(harness(), [MOBILE]);

    expect(await storedApplication(harness(), 'configured-mobile')).toEqual(
      MOBILE_STORED,
    );
  });

  it('updates the name, scopes and redirect addresses of a stored application', async () => {
    await reconcile(harness(), [MOBILE]);

    await reconcile(harness(), [
      {
        clientId: 'configured-mobile',
        displayName: 'Updated Mobile',
        redirectUris: ['example-native://new-callback'],
        allowedScopes: ['api', 'profile:read'],
      },
    ]);

    expect(await storedApplication(harness(), 'configured-mobile')).toEqual({
      ...MOBILE_STORED,
      displayName: 'Updated Mobile',
      redirectUris: ['example-native://new-callback'],
      allowedScopes: ['api', 'profile:read'],
      sessionVersion: 1,
    });
  });

  it.each([
    {
      change: 'only the name',
      next: { ...MOBILE, displayName: 'Renamed Mobile' },
      version: 0,
    },
    {
      change: 'only the scopes',
      next: { ...MOBILE, allowedScopes: ['api', 'profile:read'] },
      version: 0,
    },
    {
      change: 'one more redirect address',
      next: {
        ...MOBILE,
        redirectUris: ['example-native://callback', 'example-native://second'],
      },
      version: 0,
    },
    {
      change: 'one redirect address fewer',
      next: { ...MOBILE, redirectUris: ['example-native://second'] },
      version: 1,
      from: ['example-native://callback', 'example-native://second'],
    },
    {
      change: 'no redirect address left',
      next: { ...MOBILE, redirectUris: [] },
      version: 1,
    },
  ])(
    'leaves the version at $version for a change of $change',
    async ({ next, version, from }) => {
      await reconcile(harness(), [
        { ...MOBILE, redirectUris: from ?? MOBILE.redirectUris },
      ]);

      await reconcile(harness(), [next]);

      expect(await storedNatives(harness())).toEqual([
        {
          clientId: 'configured-mobile',
          environment: 'test',
          enabled: true,
          sessionVersion: version,
        },
      ]);
    },
  );

  it('enables a listed application that was switched off, and advances its version', async () => {
    await harness().seedStoredApplication(
      nativeApplication({ enabled: false, sessionVersion: 4 }),
    );

    await reconcile(harness(), [MOBILE]);

    expect(await storedNatives(harness())).toEqual([
      {
        clientId: 'configured-mobile',
        environment: 'test',
        enabled: true,
        sessionVersion: 5,
      },
    ]);
  });

  it('switches off the native applications that are no longer listed, and nothing else', async () => {
    await harness().seedStoredApplication(
      nativeApplication({ clientId: 'manual-mobile', sessionVersion: 2 }),
    );
    await harness().seedStoredApplication(
      nativeApplication({
        clientId: 'manual-mobile',
        environment: OTHER_ENVIRONMENT,
        sessionVersion: 2,
      }),
    );

    await reconcile(harness(), [MOBILE]);
    const once = await harness().storedApplications();
    await reconcile(harness(), [MOBILE]);

    const summary = (applications: typeof once) =>
      applications.map(
        ({ clientId, environment, enabled, sessionVersion }) =>
          `${environment}/${clientId} ${enabled ? 'on' : 'off'} v${sessionVersion}`,
      );
    const expected = [
      'staging/manual-mobile on v2',
      'test/admin on v0',
      'test/configured-mobile on v0',
      'test/manual-mobile off v3',
      'test/web on v0',
    ];
    expect({
      once: summary(once),
      twice: summary(await harness().storedApplications()),
    }).toEqual({ once: expected, twice: expected });
  });

  it('writes nothing when native sign-in is off', async () => {
    await harness().seedStoredApplication(
      nativeApplication({ clientId: 'manual-mobile', sessionVersion: 2 }),
    );

    await registryOn(harness(), {
      nativeEnabled: false,
      nativeApplications: [MOBILE],
    }).reconcileNativeApplications();

    expect(await storedNatives(harness())).toEqual([
      {
        clientId: 'manual-mobile',
        environment: 'test',
        enabled: true,
        sessionVersion: 2,
      },
    ]);
  });

  it('does nothing for an empty list when no native application is stored', async () => {
    await reconcile(harness(), []);

    expect(
      (await harness().storedApplications()).map(
        ({ clientId, enabled, sessionVersion }) => ({
          clientId,
          enabled,
          sessionVersion,
        }),
      ),
    ).toEqual([
      { clientId: 'admin', enabled: true, sessionVersion: 0 },
      { clientId: 'web', enabled: true, sessionVersion: 0 },
    ]);
  });

  it('refuses a listed client id that belongs to another kind of application, and stores nothing of that start', async () => {
    const failure = await rejectionOf(
      reconcile(harness(), [MOBILE, { ...SECOND_MOBILE, clientId: 'web' }]),
    );

    expect({
      message: failure instanceof Error ? failure.message : failure,
      natives: await storedNatives(harness()),
      web: (await storedApplication(harness(), 'web'))?.platform,
    }).toEqual({
      message:
        'AUTH_NATIVE_APPLICATIONS entry "web": client id belongs to an application of another kind.',
      natives: [],
      web: 'web',
    });
  });

  it.each([
    {
      after: 'the first application was stored',
      method: 'storeNativeRegistration',
    },
    {
      after: 'everything was written',
      method: 'disableNativeApplicationsExcept',
    },
  ] as const)(
    'stores nothing of a start interrupted after $after, and the next start completes it',
    async ({ method }) => {
      await harness().seedStoredApplication(
        nativeApplication({ clientId: 'manual-mobile', sessionVersion: 2 }),
      );
      const restore = failAfter(
        harness().registryStore,
        method,
        new Error(INTERRUPTED),
      );
      restores.push(restore);

      const failure = await rejectionOf(
        reconcile(harness(), [MOBILE, SECOND_MOBILE]),
      );
      const interrupted = await storedNatives(harness());
      restore();
      await reconcile(harness(), [MOBILE, SECOND_MOBILE]);

      expect({
        failure: failure instanceof Error ? failure.message : failure,
        interrupted,
        completed: await storedNatives(harness()),
      }).toEqual({
        failure: INTERRUPTED,
        interrupted: [
          {
            clientId: 'manual-mobile',
            environment: 'test',
            enabled: true,
            sessionVersion: 2,
          },
        ],
        completed: [
          {
            clientId: 'configured-mobile',
            environment: 'test',
            enabled: true,
            sessionVersion: 0,
          },
          {
            clientId: 'manual-mobile',
            environment: 'test',
            enabled: false,
            sessionVersion: 3,
          },
          {
            clientId: 'second-mobile',
            environment: 'test',
            enabled: true,
            sessionVersion: 0,
          },
        ],
      });
    },
  );
}
