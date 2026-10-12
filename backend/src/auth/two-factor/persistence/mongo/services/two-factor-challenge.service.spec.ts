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
  TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS,
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

  return {
    service: new TwoFactorChallengeService(
      new MongoSecondFactorChallengeStore(
        createModelMock<
          ConstructorParameters<typeof MongoSecondFactorChallengeStore>[0]
        >(model),
      ),
      configService,
      new TotpSecretCryptoService(configService),
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

    it('should keep the raw nonce out of the database', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      const payload = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
      ) as { nonce: string };

      const created = harness.model.create.mock.calls[0][0] as {
        nonceHash: string;
      };
      expect(created.nonceHash).not.toContain(payload.nonce);
    });
  });

  describe('read', () => {
    it('should return the challenge behind a cookie it signed', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOne.mockResolvedValue(storedChallenge());

      const context = await harness.service.read(requestWith(token));

      expect(context).toEqual({
        challengeId: CHALLENGE_ID.toString(),
        userId: USER_ID.toString(),
        firstFactor: 'password',
      });
    });

    it('should refuse a request without the cookie', async () => {
      const harness = createHarness();

      await expectChallengeInvalid(() =>
        harness.service.read(createRequestMock({ cookies: {} })),
      );
    });

    it('should refuse a cookie whose payload was edited', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      const forged = Buffer.from(
        JSON.stringify({
          sub: new Types.ObjectId().toString(),
          nonce: 'anything',
          expiresAt: EXPIRES_AT.getTime(),
        }),
      ).toString('base64url');

      await expectChallengeInvalid(() =>
        harness.service.read(requestWith(`${forged}.${token.split('.')[1]}`)),
      );
      expect(harness.model.findOne).not.toHaveBeenCalled();
    });

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

    it('should drop a record that ran out before its cookie did', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOne.mockResolvedValue(storedChallenge(0, NOW));

      await expectChallengeInvalid(() =>
        harness.service.read(requestWith(token)),
      );
      expect(harness.model.deleteOne).toHaveBeenCalledWith({
        _id: CHALLENGE_ID,
      });
    });

    it('should refuse a cookie whose record is gone', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOne.mockResolvedValue(null);

      await expectChallengeInvalid(() =>
        harness.service.read(requestWith(token)),
      );
    });

    it('should drop a challenge that ran out of tries', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOne.mockResolvedValue(
        storedChallenge(TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS),
      );

      await expectChallengeInvalid(() =>
        harness.service.read(requestWith(token)),
      );
      expect(harness.model.deleteOne).toHaveBeenCalledWith({
        _id: CHALLENGE_ID,
      });
    });
  });

  describe('claim', () => {
    it('should mark an open challenge claimed', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOneAndUpdate.mockResolvedValue(storedChallenge());

      const context = await harness.service.claim(requestWith(token));

      expect(context).toEqual({
        challengeId: CHALLENGE_ID.toString(),
        userId: USER_ID.toString(),
        firstFactor: 'password',
      });
      expect(harness.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: { $lt: TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS },
          $or: [{ claimedAt: null }, { claimedAt: { $exists: false } }],
        }),
        { $set: { claimedAt: NOW } },
        { new: true },
      );
    });

    it('should refuse a challenge another request already claimed', async () => {
      const harness = createHarness();
      const token = await issueToken(harness);
      harness.model.findOneAndUpdate.mockResolvedValue(null);

      await expectChallengeInvalid(() =>
        harness.service.claim(requestWith(token)),
      );
    });
  });

  describe('registerFailure', () => {
    it('should count a wrong code and keep the challenge open', async () => {
      const harness = createHarness();
      harness.model.findOneAndUpdate.mockResolvedValue({
        _id: CHALLENGE_ID,
        attempts: 1,
      });

      await harness.service.registerFailure(CHALLENGE_ID.toString());

      expect(harness.model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: CHALLENGE_ID },
        { $inc: { attempts: 1 }, $unset: { claimedAt: 1 } },
        { new: true },
      );
      expect(harness.model.deleteOne).not.toHaveBeenCalled();
    });

    it('should discard the challenge on the fifth wrong code', async () => {
      const harness = createHarness();
      harness.model.findOneAndUpdate.mockResolvedValue({
        _id: CHALLENGE_ID,
        attempts: TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS,
      });

      await harness.service.registerFailure(CHALLENGE_ID.toString());

      expect(harness.model.deleteOne).toHaveBeenCalledWith({
        _id: CHALLENGE_ID,
      });
    });
  });
});
