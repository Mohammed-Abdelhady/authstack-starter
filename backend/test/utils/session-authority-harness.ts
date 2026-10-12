import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Connection, Model } from 'mongoose';
import { Clock } from '../../src/common/services/clock';
import { SessionService } from '../../src/auth/persistence/mongo/session.service';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { SessionModule } from '../../src/session/session.module';
import { NativeOAuthModule } from '../../src/session/native/oauth/native-oauth.module';
import {
  Session,
  SessionDocument,
} from '../../src/session/persistence/mongo/schemas/session.schema';
import {
  Application,
  ApplicationDocument,
} from '../../src/session/persistence/mongo/schemas/application.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantDocument,
} from '../../src/session/persistence/mongo/schemas/user-application-grant.schema';
import {
  User,
  UserDocument,
} from '../../src/user/persistence/mongo/schemas/user.schema';
import { SessionAuthorityService } from '../../src/session/persistence/mongo/session-authority.service';
import { SessionRevocationService } from '../../src/session/persistence/mongo/session-revocation.service';
import { ApplicationAccessService } from '../../src/session/persistence/mongo/application-access.service';
import { FrozenClock } from './frozen-clock';

export {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from './hook-timeouts';

export interface SessionAuthorityHarness {
  app: INestApplication;
  clock: FrozenClock;
  sessionService: SessionService;
  authority: SessionAuthorityService;
  revocation: SessionRevocationService;
  applicationAccess: ApplicationAccessService;
  users: Model<UserDocument>;
  sessions: Model<SessionDocument>;
  applications: Model<ApplicationDocument>;
  grants: Model<UserApplicationGrantDocument>;
  connection: Connection;
}

export async function bootSessionAuthority(
  mongoUri: string,
  clock: FrozenClock,
  options?: { nativeEnabled?: boolean; withNativeHttp?: boolean },
): Promise<SessionAuthorityHarness> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            auth: {
              epoch: 1,
              nativeEnabled: options?.nativeEnabled ?? false,
              nativeDpopRequired:
                process.env.AUTH_NATIVE_DPOP_REQUIRED === 'true',
              nativeDpopNonceSecret: process.env.AUTH_NATIVE_DPOP_NONCE_SECRET,
              passwordEnabled: true,
            },
            server: {
              nodeEnv: 'test',
              apiUrl: process.env.API_URL ?? 'http://localhost:5001',
            },
            cors: { clientUrl: 'http://localhost:3000' },
          }),
        ],
      }),
      MongooseModule.forRoot(mongoUri, {
        w: 'majority',
        retryWrites: true,
        readPreference: 'primary',
      }),
      SessionModule,
      ...(options?.withNativeHttp ? [NativeOAuthModule] : []),
    ],
    providers: [SessionService, Sessions],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();

  const app = module.createNestApplication();
  if (options?.withNativeHttp) {
    app.use(cookieParser());
    app.setGlobalPrefix('api');
  }
  await app.init();

  return {
    app,
    clock,
    sessionService: app.get(SessionService),
    authority: app.get(SessionAuthorityService),
    revocation: app.get(SessionRevocationService),
    applicationAccess: app.get(ApplicationAccessService),
    users: app.get<Model<UserDocument>>(getModelToken(User.name)),
    sessions: app.get<Model<SessionDocument>>(getModelToken(Session.name)),
    applications: app.get<Model<ApplicationDocument>>(
      getModelToken(Application.name),
    ),
    grants: app.get<Model<UserApplicationGrantDocument>>(
      getModelToken(UserApplicationGrant.name),
    ),
    connection: app.get(getConnectionToken()),
  };
}

export async function createTestUser(
  users: Model<UserDocument>,
  email: string,
): Promise<UserDocument> {
  return users.create({
    email,
    name: 'Session Tester',
    role: 'user',
    isVerified: true,
    sessionVersion: 0,
  });
}
