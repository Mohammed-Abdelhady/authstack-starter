import { generateSync } from 'otplib';
import {
  buildOtpauthUrl,
  checkTotpDelta,
  generateTotpSecret,
} from './totp.util';
import {
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
} from '../constants/two-factor.constants';

/**
 * Runs against the real library. It is the one place that would catch otplib
 * changing its API or its defaults under us, so nothing here is mocked.
 *
 * The clock is frozen mid-step. Without that, a run that crosses a step
 * boundary between generating a code and checking it reads one step out.
 */

const FIXED_EPOCH_SECONDS = 1700000000;
const FIXED_NOW_MS = FIXED_EPOCH_SECONDS * 1000;

/** A code as an authenticator app would show it at the given step offset. */
function codeAtOffset(secret: string, steps: number): string {
  return generateSync({
    secret,
    epoch: FIXED_EPOCH_SECONDS + steps * TOTP_STEP_SECONDS,
    period: TOTP_STEP_SECONDS,
    digits: 6,
  });
}

describe('totp adapter', () => {
  let secret: string;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
    secret = generateTotpSecret();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateTotpSecret', () => {
    it('should return a base32 secret the library accepts', () => {
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(() => codeAtOffset(secret, 0)).not.toThrow();
    });

    it('should return a different secret every time', () => {
      expect(generateTotpSecret()).not.toBe(generateTotpSecret());
    });
  });

  describe('buildOtpauthUrl', () => {
    it('should carry the account, the issuer and the secret', () => {
      const url = new URL(buildOtpauthUrl('user@example.com', secret));

      expect(url.protocol).toBe('otpauth:');
      expect(url.host).toBe('totp');
      expect(decodeURIComponent(url.pathname)).toBe(
        '/Auth App:user@example.com',
      );
      expect(url.searchParams.get('secret')).toBe(secret);
      expect(url.searchParams.get('issuer')).toBe('Auth App');
    });

    it('should leave out the step and the digits, which are the defaults', () => {
      const url = new URL(buildOtpauthUrl('user@example.com', secret));

      // otplib only writes parameters that differ from the TOTP defaults, and
      // an app reading this URI falls back to the same 30 seconds and 6 digits.
      expect(TOTP_STEP_SECONDS).toBe(30);
      expect(TOTP_DIGITS).toBe(6);
      expect(url.searchParams.get('period')).toBeNull();
      expect(url.searchParams.get('digits')).toBeNull();
    });
  });

  describe('checkTotpDelta', () => {
    it('should accept the code for the current step', () => {
      expect(checkTotpDelta(codeAtOffset(secret, 0), secret)).toBe(0);
    });

    it('should accept one step either side of the current one', () => {
      expect(checkTotpDelta(codeAtOffset(secret, -1), secret)).toBe(-1);
      expect(checkTotpDelta(codeAtOffset(secret, 1), secret)).toBe(1);
    });

    it('should refuse a code from outside the window', () => {
      expect(checkTotpDelta(codeAtOffset(secret, -2), secret)).toBeNull();
      expect(checkTotpDelta(codeAtOffset(secret, 2), secret)).toBeNull();
      expect(checkTotpDelta(codeAtOffset(secret, -120), secret)).toBeNull();
    });

    it('should refuse a code generated from another secret', () => {
      const other = generateTotpSecret();

      expect(checkTotpDelta(codeAtOffset(other, 0), secret)).toBeNull();
    });

    it.each(['12345', '1234567', 'abcdef', '', '12 34 56'])(
      'should refuse %p rather than throwing on its shape',
      (code) => {
        expect(checkTotpDelta(code, secret)).toBeNull();
      },
    );
  });
});
