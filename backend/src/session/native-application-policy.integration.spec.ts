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
import { reconcileStartupApplications } from './session.module';
import { ApplicationRegistryService } from './persistence/mongo/application-registry.service';

const TEST_ENVIRONMENT = 'test';
const NATIVE_REDIRECT = 'example-native://callback';
const BASE_APPLICATION: NativeApplicationConfiguration = {
  clientId: 'configured-mobile',
  displayName: 'Configured Mobile',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
};
const EXISTING_CLIENT_IDS = [
  BASE_APPLICATION.clientId,
  'owned-by-web',
  'owned-by-confidential',
];

describe('native application ownership and redirect policy', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let registry: ApplicationRegistryService;
  let config: ConfigService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('native_application_policy'),
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
      $or: [
        { platform: APPLICATION_PLATFORM.NATIVE },
        {
          clientId: {
            $in: [...EXISTING_CLIENT_IDS, WEB_CLIENT_ID, ADMIN_CLIENT_ID],
          },
        },
      ],
    });
    // Same first-party restore as the registry spec: the seed only writes
    // enabled and sessionVersion on insert.
    await registry.seedFirstPartyApplications();
    config.set('auth.nativeEnabled', true);
    setNativeApplications([]);
  });

  it('keeps the session version for reordered redirects and added addresses', async () => {
    const original: NativeApplicationConfiguration = {
      ...BASE_APPLICATION,
      redirectUris: ['example-native://first', 'example-native://second'],
    };
    await reconcile([original]);
    const changed: NativeApplicationConfiguration = {
      ...original,
      redirectUris: [
        'example-native://second',
        'example-native://first',
        'example-native://third',
      ],
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
      redirectUris: [
        'example-native://second',
        'example-native://first',
        'example-native://third',
      ],
      sessionVersion: 0,
    });
  });

  it.each([
    {
      kind: 'another platform',
      clientId: 'owned-by-web',
      platform: APPLICATION_PLATFORM.WEB,
      clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
    },
    {
      kind: 'a confidential client',
      clientId: 'owned-by-confidential',
      platform: APPLICATION_PLATFORM.NATIVE,
      clientType: APPLICATION_CLIENT_TYPE.CONFIDENTIAL,
    },
  ])('rejects a client id already owned by $kind', async (existing) => {
    await createExistingApplication(
      existing.clientId,
      existing.platform,
      existing.clientType,
    );
    const configured: NativeApplicationConfiguration = {
      ...BASE_APPLICATION,
      clientId: existing.clientId,
      displayName: 'Configured takeover',
      redirectUris: ['example-native://new-callback'],
    };

    let failure: unknown;
    try {
      await reconcile([configured]);
    } catch (error) {
      failure = error;
    }

    const application = await harness.applications
      .findOne({
        clientId: existing.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect({
      failure: failure instanceof Error ? failure.message : undefined,
      application: application && {
        displayName: application.displayName,
        platform: application.platform,
        clientType: application.clientType,
        enabled: application.enabled,
        redirectUris: application.redirectUris,
        allowedScopes: application.allowedScopes,
        sessionVersion: application.sessionVersion,
      },
    }).toEqual({
      failure: `AUTH_NATIVE_APPLICATIONS entry "${existing.clientId}": client id belongs to an application of another kind.`,
      application: {
        displayName: 'Existing application',
        platform: existing.platform,
        clientType: existing.clientType,
        enabled: true,
        redirectUris: [NATIVE_REDIRECT],
        allowedScopes: [DEFAULT_API_AUDIENCE],
        sessionVersion: 4,
      },
    });
  });

  it('leaves the collection unchanged when one entry conflicts', async () => {
    await createExistingApplication(
      'owned-by-web',
      APPLICATION_PLATFORM.WEB,
      APPLICATION_CLIENT_TYPE.PUBLIC,
    );
    const before = await harness.applications
      .find({})
      .sort({ clientId: 1, environment: 1 })
      .lean()
      .exec();
    expect(
      before.map(({ clientId, environment, enabled, sessionVersion }) => ({
        clientId,
        environment,
        enabled,
        sessionVersion,
      })),
    ).toEqual([
      {
        clientId: ADMIN_CLIENT_ID,
        environment: TEST_ENVIRONMENT,
        enabled: true,
        sessionVersion: 0,
      },
      {
        clientId: 'owned-by-web',
        environment: TEST_ENVIRONMENT,
        enabled: true,
        sessionVersion: 4,
      },
      {
        clientId: WEB_CLIENT_ID,
        environment: TEST_ENVIRONMENT,
        enabled: true,
        sessionVersion: 0,
      },
    ]);

    await expect(
      reconcile([
        BASE_APPLICATION,
        {
          ...BASE_APPLICATION,
          clientId: 'owned-by-web',
          redirectUris: ['example-native://new-callback'],
        },
      ]),
    ).rejects.toThrow('belongs to an application of another kind');

    const after = await harness.applications
      .find({})
      .sort({ clientId: 1, environment: 1 })
      .lean()
      .exec();
    expect(after).toEqual(before);
  });

  it('retries a duplicate-key failure and updates the record', async () => {
    await reconcile([BASE_APPLICATION]);
    const changed: NativeApplicationConfiguration = {
      ...BASE_APPLICATION,
      redirectUris: ['example-native://new-callback'],
    };
    const updateSpy = jest.spyOn(harness.applications, 'updateOne');
    updateSpy.mockImplementationOnce(() => {
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    });
    try {
      await reconcile([changed]);
    } finally {
      updateSpy.mockRestore();
    }

    const application = await harness.applications
      .findOne({
        clientId: BASE_APPLICATION.clientId,
        environment: TEST_ENVIRONMENT,
      })
      .lean()
      .exec();
    expect(application).toMatchObject({
      redirectUris: ['example-native://new-callback'],
      sessionVersion: 1,
    });
  });

  it('writes nothing without the HTTP bootstrap step', async () => {
    await harness.applications.create({
      clientId: 'manual-mobile',
      displayName: 'Manual Mobile',
      platform: APPLICATION_PLATFORM.NATIVE,
      environment: TEST_ENVIRONMENT,
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
    const second = await bootSessionAuthority(
      mongo.uri('native_application_policy'),
      new FrozenClock(TEST_NOW),
      { nativeEnabled: true },
    );
    try {
      const untouched = await second.applications
        .findOne({ clientId: 'manual-mobile', environment: TEST_ENVIRONMENT })
        .lean()
        .exec();
      expect(untouched).toMatchObject({ enabled: true, sessionVersion: 2 });
      await reconcileStartupApplications(second.app);
      const disabled = await second.applications
        .findOne({ clientId: 'manual-mobile', environment: TEST_ENVIRONMENT })
        .lean()
        .exec();
      expect(disabled).toMatchObject({ enabled: false, sessionVersion: 3 });
    } finally {
      await second.app.close();
    }
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

  async function createExistingApplication(
    clientId: string,
    platform: string,
    clientType: string,
  ): Promise<void> {
    await harness.applications.create({
      clientId,
      displayName: 'Existing application',
      platform,
      environment: TEST_ENVIRONMENT,
      clientType,
      enabled: true,
      redirectUris: [NATIVE_REDIRECT],
      allowedOrigins: [],
      audiences: [DEFAULT_API_AUDIENCE],
      allowedScopes: [DEFAULT_API_AUDIENCE],
      policy: {
        absoluteLifetimeMs: NATIVE_ABSOLUTE_LIFETIME_MS,
        idleLifetimeMs: NATIVE_IDLE_LIFETIME_MS,
      },
      sessionVersion: 4,
    });
  }
});
