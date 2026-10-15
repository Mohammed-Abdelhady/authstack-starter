import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { mongoSessionOf } from '../../session/persistence/mongo/mongo-unit-of-work';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { MAGIC_LINK_SENT_MESSAGE } from './constants/magic-link.constants';
import { hashMagicLinkToken } from './utils/magic-link-token.util';
import { TEST_NOW } from '../../../test/utils/frozen-clock';
import {
  MagicLinkHarness,
  MAGIC_LINK_MAX_PER_HOUR,
  MOCK_REQUEST,
  MOCK_RESPONSE,
  MOCK_USER,
  createMagicLinkHarness,
} from './persistence/mongo/magic-link.harness-spec';

const EMAIL = 'user@example.com';
const TOKEN = 'a-token-from-the-mailed-link';

describe('MagicLinkService', () => {
  let harness: MagicLinkHarness;

  beforeEach(async () => {
    harness = await createMagicLinkHarness();
  });

  describe('request', () => {
    it('should mail a link for an address without an account', async () => {
      const result = await harness.service.request(
        { email: EMAIL },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      expect(harness.pendingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: EMAIL,
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
          consumedAt: null,
          requestIp: '127.0.0.1',
          userAgent: 'test-agent',
        }),
      );
      expect(harness.authMailService.sendMagicLink).toHaveBeenCalledWith(
        { email: EMAIL, locale: 'en' },
        expect.stringContaining(
          'http://localhost:3000/auth/magic-link/verify?token=',
        ) as string,
        15,
      );
      expect(result.data.email).toBe(EMAIL);
      expect(result.message).toBe(MAGIC_LINK_SENT_MESSAGE);
    });

    it('should answer a known address the same way it answers an unknown one', async () => {
      const unknown = await harness.service.request(
        { email: EMAIL },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      harness.userModel.findOne.mockResolvedValueOnce(MOCK_USER);
      const known = await harness.service.request(
        { email: EMAIL },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      expect(known).toEqual(unknown);
    });

    it('should send nothing for a soft-deleted account and answer the same way', async () => {
      harness.userModel.findOne.mockResolvedValueOnce({
        ...MOCK_USER,
        isDeleted: true,
      });

      const result = await harness.service.request(
        { email: EMAIL },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      expect(harness.pendingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL, consumedAt: TEST_NOW }),
      );
      expect(harness.authMailService.sendMagicLink).not.toHaveBeenCalled();
      expect(result.data.email).toBe(EMAIL);
      expect(result.message).toBe(MAGIC_LINK_SENT_MESSAGE);
    });

    it('should stop mailing once the address is past the hourly cap', async () => {
      harness.counterModel.findOneAndUpdate.mockResolvedValueOnce({
        mailedCodes: MAGIC_LINK_MAX_PER_HOUR + 1,
      });

      const result = await harness.service.request(
        { email: EMAIL },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      expect(harness.pendingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL, consumedAt: TEST_NOW }),
      );
      expect(harness.authMailService.sendMagicLink).not.toHaveBeenCalled();
      expect(result.message).toBe(MAGIC_LINK_SENT_MESSAGE);
    });

    it('should keep mailing up to the hourly cap', async () => {
      harness.counterModel.findOneAndUpdate.mockResolvedValueOnce({
        mailedCodes: MAGIC_LINK_MAX_PER_HOUR,
      });

      await harness.service.request(
        { email: EMAIL },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      expect(harness.authMailService.sendMagicLink).toHaveBeenCalledTimes(1);
    });

    it('stores an allowed native continuation with the pending link', async () => {
      const redirect = '/en/auth/native/authorize?transaction=abc-123';

      await harness.service.request(
        { email: EMAIL, redirect },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

      expect(harness.pendingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL, redirect }),
      );
    });

    it('ignores a disallowed continuation without rejecting the request', async () => {
      const result = await harness.service.request(
        {
          email: EMAIL,
          redirect: '/en/auth/native/authorize?transaction=abc&extra=yes',
        },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );
      const createPayload = harness.pendingModel.create.mock.calls[0]?.[0] as
        Record<string, unknown> | undefined;

      expect(result.data.email).toBe(EMAIL);
      expect(createPayload).not.toHaveProperty('redirect');
    });
  });

  describe('verify', () => {
    /** Opened where no nonce is held, by someone who confirmed it. */
    const verify = () =>
      harness.service.verify(
        { token: TOKEN, confirm: true },
        MOCK_REQUEST,
        MOCK_RESPONSE,
      );

    function pendingLink(expiresAt: Date): {
      email: string;
      expiresAt: Date;
      redirect?: string;
    } {
      return { email: EMAIL, expiresAt };
    }

    it('should spend the link once and sign the account in', async () => {
      const check = jest.spyOn(harness.policy, 'assertMayCreate');
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() + 60000)),
      );
      harness.userModel.findOne.mockResolvedValueOnce(MOCK_USER);

      const result = await verify();

      expect(harness.pendingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tokenHash: hashMagicLinkToken(TOKEN), consumedAt: null },
        { $set: { consumedAt: expect.any(Date) as Date } },
        { new: true },
      );
      expect(harness.signInService.completeSignIn).toHaveBeenCalledWith(
        MOCK_USER,
        MOCK_RESPONSE,
        'magic_link', // feature:totp
      );
      expect(check).not.toHaveBeenCalled();
      expect(result.data.requiresTwoFactor).toBe(false);
      expect(result.data.user).toMatchObject({
        email: EMAIL,
        permissions: ['read'],
      });
    });

    it('should hold the sign-in when the account owes a second factor', async () => {
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() + 60000)),
      );
      harness.userModel.findOne.mockResolvedValueOnce(MOCK_USER);
      harness.signInService.completeSignIn.mockResolvedValueOnce({
        requiresTwoFactor: true,
      });

      const result = await verify();

      expect(result.data).toEqual({ requiresTwoFactor: true, user: null });
    });

    it('returns the stored continuation when a second factor is required', async () => {
      const redirect = '/en/auth/native/authorize?transaction=abc-123';
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce({
        ...pendingLink(new Date(harness.clock.now().getTime() + 60000)),
        redirect,
      });
      harness.userModel.findOne.mockResolvedValueOnce(MOCK_USER);
      harness.signInService.completeSignIn.mockResolvedValueOnce({
        requiresTwoFactor: true,
      });

      const result = await verify();

      expect(result.data).toEqual({
        requiresTwoFactor: true,
        user: null,
        redirect,
      });
    });

    it('should create a verified account without a password for a new address', async () => {
      const check = jest.spyOn(harness.policy, 'assertMayCreate');
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() + 60000)),
      );

      await verify();

      expect(check).toHaveBeenCalledTimes(1);
      const [request, work] = check.mock.calls[0];
      expect(request).toEqual({
        application: WEB_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
      });
      expect(harness.userModel.create).toHaveBeenCalledWith(
        [
          {
            email: EMAIL,
            name: 'user',
            isVerified: true,
            authProvider: 'email',
            primaryProvider: 'email',
            locale: 'en',
          },
        ],
        { session: mongoSessionOf(work) },
      );
    });

    it('should reject a token that was already spent', async () => {
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(null);

      await expect(verify()).rejects.toMatchObject({
        code: ErrorCode.MAGIC_LINK_INVALID,
        status: 400,
      });
      expect(harness.signInService.completeSignIn).not.toHaveBeenCalled();
    });

    it('returns the stored continuation after sign-in', async () => {
      const redirect = '/en/auth/native/authorize?transaction=abc-123';
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce({
        ...pendingLink(new Date(harness.clock.now().getTime() + 60000)),
        redirect,
      });
      harness.userModel.findOne.mockResolvedValueOnce(MOCK_USER);

      const result = await verify();

      expect(result.data.redirect).toBe(redirect);
    });

    it('does not add a continuation when none was stored', async () => {
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() + 60000)),
      );
      harness.userModel.findOne.mockResolvedValueOnce(MOCK_USER);

      const result = await verify();

      expect(result.data).not.toHaveProperty('redirect');
    });

    it('should reject an expired token', async () => {
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() - 1000)),
      );

      await expect(verify()).rejects.toMatchObject({
        code: ErrorCode.MAGIC_LINK_INVALID,
      });
      expect(harness.userModel.findOne).not.toHaveBeenCalled();
    });

    it('should reject a link that belongs to a soft-deleted account', async () => {
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() + 60000)),
      );
      harness.userModel.findOne.mockResolvedValueOnce({
        ...MOCK_USER,
        isDeleted: true,
      });

      await expect(verify()).rejects.toMatchObject({
        code: ErrorCode.MAGIC_LINK_INVALID,
      });
      expect(harness.signInService.completeSignIn).not.toHaveBeenCalled();
    });

    it('should verify an account that had not confirmed its address', async () => {
      const unverified = {
        ...MOCK_USER,
        isVerified: false,
        save: jest.fn().mockResolvedValue(undefined),
      };
      harness.pendingModel.findOneAndUpdate.mockResolvedValueOnce(
        pendingLink(new Date(harness.clock.now().getTime() + 60000)),
      );
      harness.userModel.findOne.mockResolvedValueOnce(unverified);

      await verify();

      expect(unverified.isVerified).toBe(true);
      expect(unverified.save).toHaveBeenCalled();
    });
  });
});
