import { ConfigService } from '@nestjs/config';
import { startMemoryReplSet } from '../../test/utils/memory-replset';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../test/utils/session-authority-harness';
import { FrozenClock, TEST_NOW } from '../../test/utils/frozen-clock';
import type { NativeApplicationConfiguration } from '../config/types/native-application.type';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
  WEB_CLIENT_ID,
} from './constants/client-ids';
import {
  NATIVE_ABSOLUTE_LIFETIME_MS,
  NATIVE_IDLE_LIFETIME_MS,
} from './constants/session-policy';
import { ApplicationRegistryService } from './persistence/mongo/application-registry.service';

const TEST_ENVIRONMENT = 'test';
const NATIVE_REDIRECT = 'example-native://callback';
const BASE_APPLICATION: NativeApplicationConfiguration = {
  clientId: 'configured-mobile',
  displayName: 'Configured Mobile',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
};

describe('ApplicationRegistryService native configuration reconciliation', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let registry: ApplicationRegistryService;
  let config: ConfigService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('native_application_registry'),
      new FrozenClock(TEST_NOW),
      { nativeEnabled: true },
    );
    registry = harness.app.get(ApplicationRegistryService);
    config = harness.app.get(ConfigService);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) {
      await harness.app.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await harness.applications.deleteMany({
      platform: APPLICATION_PLATFORM.NATIVE,
    });
    // Earlier tests may disable first-party records, which the seed only
    // writes on insert, so reseed from a clean slate.
    await harness.applications.deleteMany({
      clientId: { $in: [WEB_CLIENT_ID, ADMIN_CLIENT_ID] },
    });
    await registry.seedFirstPartyApplications();
    config.set('auth.nativeEnabled', true);
    setNativeApplications([]);
  });

  it('creates an enabled public native application for the current environment', async () => {
    await reconcile([BASE_APPLICATION]);

    const application = await harness.applications
      .findOne({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect(application).toMatchObject({
      clientId: 'configured-mobile',
      displayName: 'Configured Mobile',
      platform: 'native',
      clientType: 'public',
      environment: 'test',
      enabled: true,
      redirectUris: ['example-native://callback'],
      allowedOrigins: [],
      audiences: ['api'],
      allowedScopes: ['api'],
      policy: { absoluteLifetimeMs: 2592000000, idleLifetimeMs: 604800000 },
      sessionVersion: 0,
    });
  });

  it('updates configuration fields and advances the session version for changed redirects', async () => {
    await reconcile([BASE_APPLICATION]);
    await harness.applications.updateOne(
      { clientId: BASE_APPLICATION.clientId, environment: TEST_ENVIRONMENT },
      { $unset: { sessionVersion: 1 } },
    );
    const changed: NativeApplicationConfiguration = {
      ...BASE_APPLICATION,
      displayName: 'Updated Mobile',
      redirectUris: ['example-native://new-callback'],
      allowedScopes: ['api', 'profile:read'],
    };

    await reconcile([changed]);

    const application = await harness.applications
      .findOne({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect(application).toMatchObject({
      displayName: 'Updated Mobile',
      redirectUris: ['example-native://new-callback'],
      allowedScopes: ['api', 'profile:read'],
      sessionVersion: 1,
    });
  });

  it('advances the session version when a listed application is re-enabled', async () => {
    await reconcile([BASE_APPLICATION]);
    await harness.applications.updateOne(
      { clientId: BASE_APPLICATION.clientId, environment: TEST_ENVIRONMENT },
      { $set: { enabled: false, sessionVersion: 4 } },
    );

    await reconcile([BASE_APPLICATION]);

    const application = await harness.applications
      .findOne({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect(application).toMatchObject({ enabled: true, sessionVersion: 5 });
  });

  it('disables omitted native applications without deleting them or changing another environment', async () => {
    await createManualApplication('manual-mobile', TEST_ENVIRONMENT);
    await createManualApplication('manual-mobile', 'staging');

    await reconcile([]);

    const applications = await harness.applications
      .find({ clientId: 'manual-mobile' })
      .select({ environment: 1, enabled: 1, sessionVersion: 1 })
      .sort({ environment: 1 })
      .lean()
      .exec();
    expect(
      applications.map(({ environment, enabled, sessionVersion }) => ({
        environment,
        enabled,
        sessionVersion,
      })),
    ).toEqual([
      { environment: 'staging', enabled: true, sessionVersion: 2 },
      { environment: 'test', enabled: false, sessionVersion: 3 },
    ]);
  });

  it('leaves first-party web and admin applications after an empty list', async () => {
    await reconcile([]);

    const applications = await harness.applications
      .find({ clientId: { $in: [WEB_CLIENT_ID, ADMIN_CLIENT_ID] } })
      .sort({ clientId: 1 })
      .lean()
      .exec();
    expect(applications).toHaveLength(2);
    expect(applications).toMatchObject([
      { clientId: ADMIN_CLIENT_ID, enabled: true, sessionVersion: 0 },
      { clientId: WEB_CLIENT_ID, enabled: true, sessionVersion: 0 },
    ]);
  });

  it('leaves a disabled version alone on a second empty reconciliation', async () => {
    await createManualApplication('manual-mobile', TEST_ENVIRONMENT);
    await reconcile([]);
    const once = await harness.applications
      .findOne({ clientId: 'manual-mobile', environment: TEST_ENVIRONMENT })
      .lean()
      .exec();

    await reconcile([]);

    const twice = await harness.applications
      .findOne({ clientId: 'manual-mobile', environment: TEST_ENVIRONMENT })
      .lean()
      .exec();
    expect(twice?.sessionVersion).toBe(once?.sessionVersion);
    expect(twice).toMatchObject({ enabled: false, sessionVersion: 3 });
  });

  it.each([
    ['a display name', { ...BASE_APPLICATION, displayName: 'Renamed Mobile' }],
    ['scopes', { ...BASE_APPLICATION, allowedScopes: ['api', 'profile:read'] }],
  ])('keeps the version for a change to only %s', async (_label, changed) => {
    await reconcile([BASE_APPLICATION]);

    await reconcile([changed]);

    const application = await harness.applications
      .findOne({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect(application).toMatchObject({ sessionVersion: 0 });
  });

  it.each([
    { field: 'displayName', restored: { displayName: 'Configured Mobile' } },
    { field: 'enabled', restored: { enabled: true } },
  ])(
    'preserves version 7 for a record without $field',
    async ({ field, restored }) => {
      await reconcile([BASE_APPLICATION]);
      await harness.applications.updateOne(
        { clientId: BASE_APPLICATION.clientId, environment: TEST_ENVIRONMENT },
        { $unset: { [field]: 1 }, $set: { sessionVersion: 7 } },
      );

      await reconcile([BASE_APPLICATION]);

      const application = await harness.applications
        .findOne({
          clientId: BASE_APPLICATION.clientId,
          environment: TEST_ENVIRONMENT,
        })
        .lean()
        .exec();
      expect(application).toMatchObject({ ...restored, sessionVersion: 7 });
    },
  );

  it('keeps a second reconciliation from changing the stored version', async () => {
    setNativeApplications([BASE_APPLICATION]);
    await registry.reconcileNativeApplications();
    await registry.reconcileNativeApplications();

    const application = await harness.applications
      .findOne({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect(application).toMatchObject({ enabled: true, sessionVersion: 0 });
  });

  it('converges concurrent reconciliations to one stored application', async () => {
    setNativeApplications([BASE_APPLICATION]);
    await Promise.all([
      registry.reconcileNativeApplications(),
      registry.reconcileNativeApplications(),
    ]);

    const [count, application] = await Promise.all([
      harness.applications.countDocuments({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      }),
      harness.applications
        .findOne({
          clientId: BASE_APPLICATION.clientId,
          environment: TEST_ENVIRONMENT,
        })
        .lean()
        .exec(),
    ]);
    expect({
      count,
      enabled: application?.enabled,
      sessionVersion: application?.sessionVersion,
    }).toEqual({
      count: 1,
      enabled: true,
      sessionVersion: 0,
    });
  });

  it('does not write the configured list when native sign-in is disabled', async () => {
    config.set('auth.nativeEnabled', false);
    setNativeApplications([BASE_APPLICATION]);

    await registry.reconcileNativeApplications();

    expect(
      await harness.applications.countDocuments({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      }),
    ).toBe(0);
  });

  async function reconcile(
    applications: NativeApplicationConfiguration[],
  ): Promise<void> {
    setNativeApplications(applications);
    await registry.reconcileNativeApplications();
  }

  function setNativeApplications(
    applications: NativeApplicationConfiguration[],
  ): void {
    config.set('auth.nativeApplications', applications);
    // ConfigService.set mirrors the value into process.env under the dotted
    // key, which would shadow the default for any harness booted later in
    // this process. Arrays become "" or "[object Object]" there.
    delete process.env['auth.nativeApplications'];
  }

  async function createManualApplication(
    clientId: string,
    environment: string,
  ): Promise<void> {
    await harness.applications.create({
      clientId,
      displayName: 'Manual Mobile',
      platform: APPLICATION_PLATFORM.NATIVE,
      environment,
      clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
      enabled: true,
      redirectUris: [NATIVE_REDIRECT],
      allowedOrigins: [],
      audiences: [DEFAULT_API_AUDIENCE],
      allowedScopes: [DEFAULT_API_AUDIENCE],
      policy: {
        absoluteLifetimeMs: NATIVE_ABSOLUTE_LIFETIME_MS,
        idleLifetimeMs: NATIVE_IDLE_LIFETIME_MS,
      },
      sessionVersion: 2,
    });
  }
});
