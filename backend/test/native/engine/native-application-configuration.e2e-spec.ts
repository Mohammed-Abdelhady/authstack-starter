import {
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  beginNativeAuthorization,
} from '../../utils/native/native-authorize.fixtures';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { watchFixtureConnections } from '../../utils/e2e-storage';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

describe('native application configuration at startup', () => {
  let e2e: E2eApp | undefined;

  afterEach(async () => {
    await e2e?.close();
    e2e = undefined;
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it(
    'starts authorization for a client declared only in configuration',
    async () => {
      e2e = await bootE2eApp(0, {
        nativeEnabled: true,
        nativeApplications: [
          {
            clientId: NATIVE_CLIENT_ID,
            displayName: 'Configured Mobile',
            redirectUris: [NATIVE_REDIRECT],
            allowedScopes: ['api'],
          },
        ],
      });

      const application =
        await e2e.state.applications.application(NATIVE_CLIENT_ID);
      expect(application).toMatchObject({
        clientId: NATIVE_CLIENT_ID,
        displayName: 'Configured Mobile',
        platform: 'native',
        clientType: 'public',
        enabled: true,
        redirectUris: [NATIVE_REDIRECT],
      });

      const started = await beginNativeAuthorization(e2e);
      const transaction = await e2e.state.native.authorizationRequest(
        started.transactionId,
      );
      expect(transaction).toMatchObject({
        transactionId: started.transactionId,
        clientId: NATIVE_CLIENT_ID,
        redirectUri: NATIVE_REDIRECT,
        consumed: false,
      });
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );

  it(
    'rejects an unacceptable redirect address before startup completes',
    async () => {
      const originalNativeEnabled = process.env.AUTH_NATIVE_ENABLED;
      process.env.AUTH_NATIVE_ENABLED = 'preserved-before-failed-boot';
      const originalDirectory = process.cwd();
      const originalEnvironment = new Map(Object.entries(process.env));
      const connections = await watchFixtureConnections();

      try {
        await expect(
          bootE2eApp(0, {
            nativeEnabled: true,
            nativeApplications: [
              {
                clientId: NATIVE_CLIENT_ID,
                displayName: 'Configured Mobile',
                redirectUris: ['http://example.com/callback'],
                allowedScopes: ['api'],
              },
            ],
          }),
        ).rejects.toThrow(/AUTH_NATIVE_APPLICATIONS.*redirectUris\[0\]/);

        const environmentRestored =
          [...originalEnvironment].every(
            ([key, value]) => process.env[key] === value,
          ) &&
          Object.keys(process.env).every((key) => originalEnvironment.has(key));
        const retrying = await connections.retryingConnections();
        expect({
          directoryRestored: process.cwd() === originalDirectory,
          environmentRestored,
          probePreserved: await connections.probePreserved(),
          retryingConnections: retrying,
        }).toEqual({
          directoryRestored: true,
          environmentRestored: true,
          probePreserved: true,
          retryingConnections: 0,
        });
      } finally {
        await connections.close();
        process.chdir(originalDirectory);
        for (const key of Object.keys(process.env)) {
          if (!originalEnvironment.has(key)) delete process.env[key];
        }
        for (const [key, value] of originalEnvironment) {
          process.env[key] = value;
        }
        if (originalNativeEnabled === undefined) {
          delete process.env.AUTH_NATIVE_ENABLED;
        } else {
          process.env.AUTH_NATIVE_ENABLED = originalNativeEnabled;
        }
      }
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );

  it(
    'ignores an invalid native client list when native sign-in is disabled',
    async () => {
      e2e = await bootE2eApp(0, {
        nativeEnabled: false,
        nativeApplications: [
          {
            clientId: NATIVE_CLIENT_ID,
            displayName: 'Configured Mobile',
            redirectUris: ['http://example.com/callback'],
            allowedScopes: ['api'],
          },
        ],
      });

      expect(
        await e2e.state.applications.applicationCount(NATIVE_CLIENT_ID),
      ).toBe(0);
    },
    SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  );
});
