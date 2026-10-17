import type { Response } from 'supertest';
// feature:mongodb:start
import { getModelToken } from '@nestjs/mongoose';
import { MongoNetworkError } from 'mongodb';
import type { Model } from 'mongoose';
import { Session } from '../../src/session/persistence/mongo/schemas/session.schema';
import { User } from '../../src/user/persistence/mongo/schemas/user.schema';
// feature:mongodb:end
import { forStorage } from '../../src/common/persistence/storage-choice';
// feature:postgres:start
import { failPostgresRead } from '../postgres/outage-read-fault.harness-spec';
// feature:postgres:end
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent, // feature:email-password
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { refusalAnswer } from '../utils/route-id-answers';

const DRIVER_TEXT = 'connect ECONNREFUSED 10.0.0.9:5432';

describe('a request while the store is unavailable (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function failRead(read: 'sessions' | 'password'): () => void {
    return forStorage({
      // feature:mongodb:start
      mongodb: () => failMongoRead(read),
      // feature:mongodb:end
      // feature:postgres:start
      postgres: () => failPostgresRead(read, DRIVER_TEXT),
      // feature:postgres:end
    });
  }

  // feature:mongodb:start
  function failMongoRead(read: 'sessions' | 'password'): () => void {
    const name = read === 'sessions' ? Session.name : User.name;
    const collection = e2e.app.get<Model<unknown>>(
      getModelToken(name),
    ).collection;
    const spy = jest
      .spyOn(collection, read === 'sessions' ? 'find' : 'findOne')
      .mockImplementation(() => {
        throw new MongoNetworkError(DRIVER_TEXT);
      });
    return () => spy.mockRestore();
  }
  // feature:mongodb:end

  /** A server failure in the shared envelope, with nothing of the driver in it. */
  function expectOutageAnswer(
    response: Response,
    status: number,
    code: ErrorCode,
  ): void {
    const answer = refusalAnswer(response);
    expect(answer.status).toBe(status);
    expect(answer).toMatchObject({
      success: false,
      bodyKeys: ['error', 'requestId', 'success'],
      errorKeys: ['code', 'message'],
      code,
    });
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.9');
  }

  it('answers the session list as a server failure, then serves it again', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const restore = failRead('sessions');
    try {
      expectOutageAnswer(
        await browser.get('/api/user/sessions'),
        503,
        ErrorCode.AUTHORITY_UNAVAILABLE,
      );
    } finally {
      restore();
    }

    await browser.get('/api/user/sessions').expect(200);
  });

  // feature:email-password:start
  it('answers a password sign-in as a server failure, with no session', async () => {
    const agent = await browserAgent(e2e.httpServer);
    const status = forStorage({
      mongodb: () => 500, // feature:mongodb
      postgres: () => 503, // feature:postgres
    });
    const restore = failRead('password');
    try {
      const response = await agent
        .post('/api/auth/login')
        .send({ email: SEED_USER.email, password: SEED_USER.password });

      expectOutageAnswer(response, status, ErrorCode.INTERNAL_ERROR);
    } finally {
      restore();
    }
    await agent.get('/api/user/profile').expect(401);
  });
  // feature:email-password:end
});
