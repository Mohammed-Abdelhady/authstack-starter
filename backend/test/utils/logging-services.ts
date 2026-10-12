import { Logger, ModuleMetadata } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import express, { Request, Response } from 'express';
import * as nodemailer from 'nodemailer';
import { AuthModule } from '../../src/auth/auth.module';
import { AdminModule } from '../../src/admin/admin.module';
import { DatabaseModule } from '../../src/database/database.module';
import { RoleSeedService } from '../../src/database/seeds/role.seed';
import { SessionService } from '../../src/auth/persistence/mongo/session.service';
import { ApplicationRegistryService } from '../../src/session/persistence/mongo/application-registry.service';
import { SessionModule } from '../../src/session/session.module';
import {
  User,
  UserDocument,
} from '../../src/user/persistence/mongo/schemas/user.schema';
import { Clock } from '../../src/common/services/clock';
import { FrozenClock, TEST_NOW } from './frozen-clock';
import { startMemoryReplSet, MemoryReplSet } from './memory-replset';

export const LOGGING_USER_ID = '507f1f77bcf86cd799439011';
export const LOGGING_EMAIL = 'user@example.com';
export const LOGGING_PASSWORD = 'Password123!';
export const LOGGING_NEW_PASSWORD = 'NewPassword123!';
export const LOGGING_ROUNDS = 4;

export interface LoggingServices {
  module: TestingModule;
  users: Model<UserDocument>;
  connection: Connection;
  clock: FrozenClock;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function bootLoggingServices(
  imports: NonNullable<ModuleMetadata['imports']> = [],
): Promise<LoggingServices> {
  const clock = new FrozenClock(TEST_NOW);
  const mongo: MemoryReplSet = await startMemoryReplSet();
  let module: TestingModule | undefined;
  const transportFactory = nodemailer.createTransport.bind(nodemailer);
  const transportSpy = jest
    .spyOn(nodemailer, 'createTransport')
    .mockImplementation(() => transportFactory({ jsonTransport: true }));
  try {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              server: { nodeEnv: 'test' },
              auth: { epoch: 1, passwordEnabled: true },
              cors: { clientUrl: 'http://localhost:3000' },
              bcrypt: { rounds: LOGGING_ROUNDS },
              smtp: { from: 'fixture@example.test' },
              magicLink: { enabled: true, maxPerHour: 5 },
              twoFactor: {
                enabled: true,
                encryptionKey: Buffer.alloc(32, 1).toString('base64'),
              },
              passkeys: {
                enabled: true,
                rpId: 'localhost',
                origin: 'http://localhost:3000',
              },
              oauth: { stateSecret: 'fixture-state-secret-0000000000000000' },
            }),
          ],
        }),
        MongooseModule.forRoot(mongo.uri('logging'), {
          w: 'majority',
          retryWrites: true,
          readPreference: 'primary',
        }),
        AuthModule,
        AdminModule,
        DatabaseModule,
        SessionModule,
        ...imports,
      ],
      providers: [SessionService],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    const fixture = module;
    const connection = fixture.get<Connection>(getConnectionToken());
    const users = fixture.get<Model<UserDocument>>(getModelToken(User.name));
    const reset = async (): Promise<void> => {
      for (const collection of Object.values(connection.collections)) {
        await collection.deleteMany({});
      }
      clock.set(TEST_NOW);
      await fixture.get(RoleSeedService).seed();
      await fixture
        .get(ApplicationRegistryService)
        .seedFirstPartyApplications();
    };
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    await reset();
    return {
      module: fixture,
      connection,
      users,
      clock,
      reset,
      close: async () => {
        try {
          await fixture.close();
        } finally {
          transportSpy.mockRestore();
          await mongo.stop();
        }
      },
    };
  } catch (error) {
    try {
      await module?.close();
    } finally {
      transportSpy.mockRestore();
      await mongo.stop();
    }
    throw error;
  }
}

export async function createLoggingUser(
  fixture: LoggingServices,
  overrides: Record<string, unknown> = {},
): Promise<UserDocument> {
  return fixture.users.create({
    _id: new Types.ObjectId(LOGGING_USER_ID),
    email: LOGGING_EMAIL,
    name: 'Test User',
    isVerified: true,
    ...overrides,
  });
}

export function loggedCalls(...spies: jest.SpyInstance[]): string {
  return spies
    .map((spy) =>
      spy.mock.calls
        .map((call: unknown[]) => call.map(String).join(' '))
        .join('\n'),
    )
    .join('\n');
}

export function captureLogs(): jest.SpyInstance {
  return jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
}

export function loggingResponse(): { request: Request; response: Response } {
  const cookies: Record<string, string> = {};
  const request = Object.assign(Object.create(express.request) as Request, {
    headers: { 'user-agent': 'logging-test' },
    cookies,
  });
  Object.defineProperty(request, 'ip', { value: '127.0.0.1' });
  const response: Response = Object.assign(
    Object.create(express.response) as Response,
    {
      req: request,
      cookie: jest.fn((name: string, value: string) => {
        cookies[name] = value;
        return response;
      }),
      clearCookie: jest.fn((name: string) => {
        delete cookies[name];
        return response;
      }),
      setHeader: jest.fn(),
    },
  );
  return { request, response };
}
