import { configureHttpApplication } from '../../src/common/security/configure-http-application';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'node:http';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { useContainer } from 'class-validator';
import * as bcrypt from 'bcrypt';
import type request from 'supertest';
import { Clock } from '../../src/common/services/clock';
import {
  SEED_ADMIN,
  SEED_MANAGER,
  SEED_SUPPORT,
  SEED_USER,
} from '../constants/seed-users';
import type { OAuthProviderStrategy } from '../../src/auth/oauth/oauth-provider.interface'; // feature:oauth-core
import { OAUTH_STRATEGIES } from '../../src/auth/oauth/oauth.constants'; // feature:oauth-core
import type { MailOptions } from '../../src/mail/interfaces/mail-options.interface';
import type { NativeApplicationConfiguration } from '../../src/config/types/native-application.type';
import { type E2eState, startE2eStorage } from './e2e-storage';
import { FrozenClock, TEST_NOW } from './frozen-clock';
import { mailedCode as lastMailedCode } from './pending-race';
import { rememberFixture } from './e2e-sign-in';
import { withTemporaryWorkingDirectory } from './temporary-working-directory';

export { browserAgent, loginAs } from './e2e-sign-in';
export type HttpServer = Server;
export type TestAgent = ReturnType<typeof request.agent>;
export const E2E_CLIENT_URL = 'http://127.0.0.1:3107';
const SEED_CREDENTIALS = [SEED_ADMIN, SEED_MANAGER, SEED_SUPPORT, SEED_USER];

function fixturePassword(email: string): string {
  const credential = SEED_CREDENTIALS.find((item) => item.email === email);
  if (!credential) {
    throw new Error('Seeded E2E accounts require an explicit test credential.');
  }
  return credential.password;
}

const BROWSER_POLICY_ENV_KEYS = [
  'ADMIN_URL',
  'AUTH_NATIVE_LINK_HOST',
  'AUTH_WEB_ENABLED',
  'AUTH_WEB_SIGN_IN',
  'AUTH_ADMIN_SIGN_IN',
  'AUTH_WEB_SESSION',
  'AUTH_ADMIN_SESSION',
];

export interface E2eApp {
  app: INestApplication;
  httpServer: HttpServer;
  mail: MailOptions[];
  clock: FrozenClock;
  /** Arranges and reads stored state the same way on either database. */
  state: E2eState;
  reset: () => Promise<void>;
  /** Await mail the anonymous routes sent off the response path, then read it. */
  captureMail: () => Promise<MailOptions[]>;
  /** Await mail, then return the 6-digit code the last captured mail carried. */
  mailedCode: () => Promise<string>;
  close: () => Promise<void>;
}

/** Optional overrides for a booted fixture. A feature's option never shifts another. */
export interface BootE2eAppOptions {
  /** Start with application records but no seeded account. */
  seedUsers?: boolean;
  nodeEnv?: string;
  browserStrategy?: OAuthProviderStrategy; // feature:oauth-core
  magicLinkEnabled?: boolean; // feature:magic-link
  /** The mail array records attempts, including the rejected ones. */
  failMail?: boolean;
  nativeEnabled?: boolean;
  nativeApplications?: NativeApplicationConfiguration[];
  nativeCustomSchemeAllowed?: boolean;
  throttleLimit?: number;
  throttleTtl?: number;
  /** Called with the application once it is built and before it starts. */
  beforeStart?: (app: INestApplication) => void;
  /** Mount routes after the real HTTP boundary and before application startup. */
  afterHttpSetup?: (app: INestApplication) => void;
}

/** Owns its database and starts configuration outside the developer's env directory. */
export async function bootE2eApp(
  port = 0,
  options: BootE2eAppOptions = {},
): Promise<E2eApp> {
  const nodeEnv = options.nodeEnv ?? 'test';
  const browserStrategy = options.browserStrategy; // feature:oauth-core
  const failMail = options.failMail === true;
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'auth-e2e-'));
  const storage = await startE2eStorage().catch(async (error: unknown) => {
    await rmdir(fixtureDirectory);
    throw error;
  });
  const environment = {
    OAUTH_STATE_SECRET: 'local-fixture-state-secret-000000000000',
    NODE_ENV: nodeEnv,
    ...storage.environment,
    CLIENT_URL: E2E_CLIENT_URL,
    API_URL: 'http://127.0.0.1:5107',
    PORT: '5107',
    // The cheapest cost is accepted in a test run only.
    BCRYPT_ROUNDS: nodeEnv === 'test' ? '4' : '10',
    THROTTLE_TTL: String(options.throttleTtl ?? 60),
    THROTTLE_LIMIT: String(options.throttleLimit ?? 1000),
    AUTH_PASSWORD_ENABLED: 'true',
    AUTH_NATIVE_ENABLED: String(options.nativeEnabled ?? false),
    AUTH_NATIVE_DPOP_NONCE_SECRET:
      'local-fixture-native-dpop-secret-000000000000',
    AUTH_NATIVE_APPLICATIONS: JSON.stringify(options.nativeApplications ?? []),
    AUTH_NATIVE_ALLOW_CUSTOM_SCHEME: String(
      options.nativeCustomSchemeAllowed ?? false,
    ),
    MAGIC_LINK_ENABLED: 'false',
    OAUTH_CALLBACK_BASE_URL: 'http://127.0.0.1:5107/api/auth/oauth', // feature:oauth-core
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1',
    EMAIL_FROM: 'fixture@example.test',
  };
  // feature:oauth-core:start
  if (browserStrategy) environment.MAGIC_LINK_ENABLED = 'true';
  // feature:oauth-core:end
  // feature:magic-link:start
  if (options.magicLinkEnabled) environment.MAGIC_LINK_ENABLED = 'true';
  // feature:magic-link:end
  const previous = new Map(Object.entries(process.env));
  const clock = new FrozenClock(TEST_NOW);
  let app: INestApplication | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    let cleanupError: unknown;
    let hasCleanupError = false;
    const recordCleanupError = (error: unknown): void => {
      if (hasCleanupError) return;
      cleanupError = error;
      hasCleanupError = true;
    };

    try {
      await app?.close();
    } catch (error) {
      recordCleanupError(error);
    }

    try {
      await storage.stop();
    } catch (error) {
      recordCleanupError(error);
    }

    for (const key of Object.keys(process.env)) {
      if (!previous.has(key)) delete process.env[key];
    }
    for (const [key, value] of previous) {
      process.env[key] = value;
    }
    try {
      await rmdir(fixtureDirectory);
    } catch (error) {
      recordCleanupError(error);
    }

    if (hasCleanupError) {
      throw cleanupError;
    }
  };

  try {
    for (const key of BROWSER_POLICY_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, environment);
    const { AppModule } = await withTemporaryWorkingDirectory(
      fixtureDirectory,
      () => import('../../src/app.module'),
    );
    const { MailService } = await import('../../src/mail/mail.service');
    const { RoleSeedService } =
      await import('../../src/database/seeds/role.seed');
    const { reconcileStartupApplications } =
      await import('../../src/session/session.module');
    const { SEED_USER_DEFINITIONS } =
      await import('../../src/database/seeds/user.seed');
    const mail: MailOptions[] = [];
    const builder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useFactory({
        inject: [ConfigService],
        factory: (configService: ConfigService) => {
          const service = Object.create(MailService.prototype) as InstanceType<
            typeof MailService
          >;
          Object.assign(service, { configService });
          service.sendMail = (options: MailOptions): Promise<void> => {
            mail.push(options);
            if (failMail) {
              return Promise.reject(new Error('mail delivery failed in test'));
            }
            return Promise.resolve();
          };
          return service;
        },
      });
    builder.overrideProvider(Clock).useValue(clock);
    await storage.prepare(builder);
    // feature:oauth-core:start
    if (browserStrategy)
      builder.overrideProvider(OAUTH_STRATEGIES).useValue([browserStrategy]);
    // feature:oauth-core:end
    const moduleFixture = await builder.compile();
    const nestApp = moduleFixture.createNestApplication({
      logger: ['error', 'warn'],
    });
    app = nestApp;
    options.beforeStart?.(nestApp);
    useContainer(nestApp.select(AppModule), { fallbackOnErrors: true });
    configureHttpApplication(nestApp);
    options.afterHttpSetup?.(nestApp);
    await nestApp.init();
    await reconcileStartupApplications(nestApp);
    await nestApp.listen(port, '127.0.0.1');
    const stored = await storage.attach(nestApp);
    const roleSeed =
      nestApp.get<InstanceType<typeof RoleSeedService>>(RoleSeedService);
    const fixtures =
      options.seedUsers === false
        ? []
        : await Promise.all(
            SEED_USER_DEFINITIONS.map(async (user) => ({
              ...user,
              permissions: [...user.permissions],
              isVerified: true,
              password: await bcrypt.hash(fixturePassword(user.email), 4),
            })),
          );
    const throttleStorage =
      nestApp.get<ThrottlerStorageService>(getStorageToken());
    const { MailDispatcherService } =
      await import('../../src/mail/mail-dispatcher.service');
    const mailDispatcher = nestApp.get(MailDispatcherService);
    const reset = async (): Promise<void> => {
      await mailDispatcher.flush();
      throttleStorage.onApplicationShutdown();
      throttleStorage.storage.clear();
      await stored.empty();
      await roleSeed.seed();
      await stored.seedApplications();
      await reconcileStartupApplications(nestApp);
      if (options.seedUsers !== false) await stored.seedAccounts(fixtures);
      mail.length = 0;
    };
    await reset();
    const httpServer = nestApp.getHttpServer() as Server;
    rememberFixture(httpServer, { app: nestApp, state: stored.state });
    return {
      app: nestApp,
      httpServer,
      mail,
      clock,
      state: stored.state,
      reset,
      captureMail: async () => {
        await mailDispatcher.flush();
        return mail;
      },
      mailedCode: async () => {
        await mailDispatcher.flush();
        return lastMailedCode(mail);
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
