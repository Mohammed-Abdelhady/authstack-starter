import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { Types } from 'mongoose';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { Clock } from '../../../common/services/clock';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { User } from '../../../user/persistence/mongo/schemas/user.schema';
import { ApplicationRegistryService } from './application-registry.service';
import { Session } from './schemas/session.schema';
import { UserApplicationGrant } from './schemas/user-application-grant.schema';
import { SessionAuthorityService } from './session-authority.service';

function resolvingQuery(value: unknown) {
  return {
    read() {
      return this;
    },
    readConcern() {
      return this;
    },
    maxTimeMS() {
      return this;
    },
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    exec: () => Promise.resolve(value),
  };
}

function rejectingQuery(error: Error) {
  return {
    read() {
      return this;
    },
    readConcern() {
      return this;
    },
    maxTimeMS() {
      return this;
    },
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    exec: () => Promise.reject(error),
  };
}

describe('SessionAuthorityService query failures', () => {
  let module: TestingModule;
  let authority: SessionAuthorityService;
  const userId = new Types.ObjectId();

  async function createService(
    failingSessionQuery: ReturnType<typeof rejectingQuery>,
  ) {
    const userQuery = resolvingQuery({
      _id: userId,
      isDeleted: false,
      sessionVersion: 0,
    });
    module = await Test.createTestingModule({
      providers: [
        SessionAuthorityService,
        {
          provide: getModelToken(Session.name),
          useValue: {
            findById: () => failingSessionQuery,
            findOne: () => failingSessionQuery,
            find: () => failingSessionQuery,
          },
        },
        {
          provide: getModelToken(User.name),
          useValue: { findById: () => userQuery },
        },
        {
          provide: getModelToken(UserApplicationGrant.name),
          useValue: {},
        },
        {
          provide: ApplicationRegistryService,
          useValue: {},
        },
        { provide: Clock, useValue: { now: () => new Date(0) } },
        { provide: AuthEpochService, useValue: { current: () => 1 } },
      ],
    }).compile();
    authority = module.get(SessionAuthorityService);
  }

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('maps a rejected list query to authority unavailable', async () => {
    await createService(
      rejectingQuery(new MongoNetworkError('connection closed')),
    );
    const failure = await authority
      .listActive(userId)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });
  });

  it('maps a rejected id query to authority unavailable', async () => {
    await createService(
      rejectingQuery(new MongoNetworkError('connection closed')),
    );
    const failure = await authority
      .getById(new Types.ObjectId().toString())
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });
  });

  it('maps a rejected token query to authority unavailable', async () => {
    await createService(
      rejectingQuery(new MongoNetworkError('connection closed')),
    );
    const failure = await authority
      .getByToken('session-token')
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });
  });

  it('maps a server read timeout during validation to service unavailable', async () => {
    const timeoutError = new MongoServerError({
      ok: 0,
      code: 50,
      codeName: 'MaxTimeMSExpired',
      errmsg: 'operation exceeded time limit',
    });
    await createService(rejectingQuery(timeoutError));
    const failure = await authority
      .validate('session-token', { extendIdle: false })
      .catch((error: unknown) => error);
    const response =
      failure instanceof AppException
        ? { code: failure.getCode(), status: failure.getStatus() }
        : null;

    expect(response).toEqual({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
