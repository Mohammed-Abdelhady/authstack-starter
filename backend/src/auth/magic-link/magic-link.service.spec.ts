import { MAGIC_LINK_SENT_MESSAGE } from './constants/magic-link.constants';
import {
  MagicLinkHarness,
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
  });
});
