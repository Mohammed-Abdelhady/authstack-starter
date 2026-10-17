import { browserApplicationsForTest } from '../../../../../common/testing/browser-applications.harness-spec';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { TwoFactorChallengeService } from '../../../services/two-factor-challenge.service';
import { TotpSecretCryptoService } from '../../../services/totp-secret-crypto.service';
import { MongoSecondFactorChallengeStore } from '../mongo-second-factor-challenge.store';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { createModelMock } from '../../../../../common/testing/test-doubles.harness-spec';
import {
  createRequestMock,
  createResponseMock,
} from '../../../../../common/testing/test-doubles.harness-spec';
import {
  TWO_FACTOR_CHALLENGE_COOKIE,
  TWO_FACTOR_CHALLENGE_TTL_MS,
} from '../../../constants/two-factor.constants';

const KEY = Buffer.alloc(32, 7).toString('base64');
const USER_ID = new Types.ObjectId('507f1f77bcf86cd799439011');
const CHALLENGE_ID = new Types.ObjectId('507f1f77bcf86cd799439012');
/** The frozen clock, and the instant a challenge issued at it runs out. */
const NOW = new Date('2026-01-02T03:04:05.000Z');
const LAST_GOOD_INSTANT = new Date('2026-01-02T03:09:04.999Z');
const EXPIRES_AT = new Date('2026-01-02T03:09:05.000Z');

interface Harness {
  service: TwoFactorChallengeService;
  model: {
    create: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    deleteOne: jest.Mock;
  };
}

function createHarness(): Harness {
  const model = {
    create: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };

  const configService = new ConfigService({
    'twoFactor.encryptionKey': KEY,
    NODE_ENV: 'test',
  });
  const browserApplications = browserApplicationsForTest(configService);

  return {
    service: new TwoFactorChallengeService(
      new MongoSecondFactorChallengeStore(
        createModelMock<
          ConstructorParameters<typeof MongoSecondFactorChallengeStore>[0]
        >(model),
      ),
      configService,
      new TotpSecretCryptoService(configService),
      browserApplications,
    ),
    model,
  };
}

function responseSpy(): { response: Response; cookie: jest.Mock } {
  const cookie = jest.fn();
  return {
    response: createResponseMock({ cookie, clearCookie: jest.fn() }),
    cookie,
  };
}

function requestWith(token: string): Request {
  return createRequestMock({
    cookies: { [TWO_FACTOR_CHALLENGE_COOKIE]: token },
  });
}

/** Issues a challenge and hands back the cookie value it wrote. */
async function issueToken(harness: Harness): Promise<string> {
  const { response, cookie } = responseSpy();
  await harness.service.issue(USER_ID, response, 'password');
  return cookie.mock.calls[0][1] as string;
}

/** Record the model returns for a token that is still good. */
function storedChallenge(
  attempts = 0,
  expiresAt = EXPIRES_AT,
): Record<string, unknown> {
  return { _id: CHALLENGE_ID, user: USER_ID, attempts, expiresAt };
}

async function expectChallengeInvalid(
  run: () => Promise<unknown>,
): Promise<void> {
  await expect(run()).rejects.toMatchObject({
    code: ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
    status: HttpStatus.UNAUTHORIZED,
  });
}

describe('TwoFactorChallengeService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issue', () => {
    it('should store the nonce hash and set a signed cookie', async () => {
      const harness = createHarness();
      const { response, cookie } = responseSpy();

      await harness.service.issue(USER_ID, response, 'password');

      expect(harness.model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: USER_ID,
          attempts: 0,
          expiresAt: EXPIRES_AT,
          nonceHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        }),
      );
      expect(cookie).toHaveBeenCalledWith(
        TWO_FACTOR_CHALLENGE_COOKIE,
        expect.stringMatching(/^[\w-]+\.[\w-]+$/) as string,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          maxAge: TWO_FACTOR_CHALLENGE_TTL_MS,
        }),
      );
    });
  });

  describe('read', () => {
    it('should accept a cookie in its last millisecond', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOne.mockResolvedValue(storedChallenge());
      jest.setSystemTime(LAST_GOOD_INSTANT);

      await expect(
        harness.service.read(requestWith(token)),
      ).resolves.toMatchObject({ challengeId: CHALLENGE_ID.toString() });
    });

    it.each([
      ['the instant it runs out', EXPIRES_AT],
      ['a second after it ran out', new Date('2026-01-02T03:09:06.000Z')],
    ])('should refuse a cookie at %s, unread', async (_label, instant) => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOne.mockResolvedValue(storedChallenge());
      jest.setSystemTime(instant);

      await expectChallengeInvalid(() =>
        harness.service.read(requestWith(token)),
      );
      expect(harness.model.findOne).not.toHaveBeenCalled();
    });
  });
});
