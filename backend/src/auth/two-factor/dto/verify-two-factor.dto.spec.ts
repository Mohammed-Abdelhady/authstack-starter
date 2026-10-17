import * as crypto from 'crypto';
import { totpCodeAt } from '../../../../test/utils/auth/two-factor-enrolment';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { createValidationPipe } from '../../../common/pipes/validation-pipe.factory';
// feature:passkeys:start
import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  createSoftwareAuthenticator,
} from '../../passkeys/services/software-authenticator.harness-spec';
import { WebAuthnAdapter } from '../../passkeys/services/webauthn.adapter';
// feature:passkeys:end
import { generateRecoveryCodes } from '../utils/recovery-code.util';
import { checkTotpDelta, generateTotpSecret } from '../utils/totp.util';
import { VerifyTwoFactorDto } from './verify-two-factor.dto';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, randomBytes: jest.fn(actual.randomBytes) };
});

/**
 * The second-step body through the validation pipe the server installs, fed
 * with what the real generators hand a user.
 */

const pipe = createValidationPipe();

function throughPipe(body: unknown): Promise<VerifyTwoFactorDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: VerifyTwoFactorDto,
  }) as Promise<VerifyTwoFactorDto>;
}

async function refusedFields(body: unknown): Promise<string[]> {
  const refusal: unknown = await throughPipe(body).then(
    () => null,
    (error: unknown) => error,
  );
  const answer = Object(refusal) as {
    getCode?: () => string;
    getDetails?: () => { fields?: Record<string, string[]> };
  };
  expect(answer.getCode?.()).toBe(ErrorCode.VALIDATION_ERROR);
  return Object.keys(answer.getDetails?.()?.fields ?? {});
}

describe('the test code generator', () => {
  // RFC 6238 appendix B, SHA-1 rows, cut to six digits.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it.each([
    ['1970-01-01T00:00:59.000Z', '287082'],
    ['2005-03-18T01:58:29.000Z', '081804'],
    ['2009-02-13T23:31:30.000Z', '005924'],
  ])('shows the published code at %s', (instant, code) => {
    expect(totpCodeAt(RFC_SECRET, new Date(instant))).toBe(code);
  });
});

describe('VerifyTwoFactorDto through the validation pipe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('recovery codes', () => {
    it('accepts every code of a generated batch, unchanged', async () => {
      // One byte per character, so these four draws walk the whole alphabet.
      const draws: jest.Mock = jest.mocked(crypto.randomBytes);
      draws
        .mockReturnValueOnce(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
        .mockReturnValueOnce(
          Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]),
        )
        .mockReturnValueOnce(
          Buffer.from([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]),
        )
        .mockReturnValueOnce(
          Buffer.from([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]),
        );
      const codes = generateRecoveryCodes();

      expect(codes.slice(0, 4)).toEqual([
        'ABCDEFGHIJ',
        'KLMNOPQRST',
        'UVWXYZ2345',
        '67ABCDEFGH',
      ]);
      expect(codes).toHaveLength(10);
      for (const recoveryCode of codes) {
        await expect(throughPipe({ recoveryCode })).resolves.toEqual({
          recoveryCode,
        });
      }
    });

    it.each([
      ['lower case', 'uvwxyz2345'],
      ['split by a dash', 'UVWXY-Z2345'],
      ['split by spaces', 'UVWXY Z2345 '],
      ['the longest form allowed', 'U-V-W-X-Y-Z-2-3-4-5     '],
    ])('accepts a code retyped %s', async (_form, recoveryCode) => {
      await expect(throughPipe({ recoveryCode })).resolves.toEqual({
        recoveryCode,
      });
    });

    it.each([
      ['one character short', 'UVWXYZ234'],
      ['one character too long', 'U-V-W-X-Y-Z-2-3-4-5      '],
      ['holding a digit base32 leaves out', 'UVWXYZ2341'],
      ['holding a symbol', 'UVWXYZ234!'],
      ['empty', ''],
    ])('refuses a code %s', async (_form, recoveryCode) => {
      expect(await refusedFields({ recoveryCode })).toEqual(['recoveryCode']);
    });
  });

  describe('authenticator codes', () => {
    it('accepts the code a generated secret shows, and the checker reads it', async () => {
      const now = new Date('2026-01-02T03:04:05.000Z');
      jest.useFakeTimers().setSystemTime(now);
      const secret = generateTotpSecret();
      const code = totpCodeAt(secret, now);

      const dto = await throughPipe({ code });

      expect(dto).toEqual({ code });
      expect(checkTotpDelta(dto.code ?? '', secret)).toBe(0);
    });

    it('keeps the leading zeros of a code', async () => {
      await expect(throughPipe({ code: '005924' })).resolves.toEqual({
        code: '005924',
      });
    });

    it.each([
      ['five digits', '12345'],
      ['seven digits', '1234567'],
      ['a letter', '12345a'],
      ['a space', '123 456'],
    ])('refuses a code of %s', async (_form, code) => {
      expect(await refusedFields({ code })).toEqual(['code']);
    });
  });

  // feature:passkeys:start
  describe('a passkey answer', () => {
    const EXPECTED = {
      challenge: 'c2VydmVyLWNoYWxsZW5nZQ',
      origin: 'http://localhost:3000',
      rpId: 'localhost',
    };

    function signedCredential() {
      const authenticator = createSoftwareAuthenticator(
        Buffer.from('software-credential'),
      );
      const credential = assertionCredential(authenticator, {
        ...EXPECTED,
        flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
        counter: 1,
      });
      return { authenticator, credential };
    }

    it('keeps every part of the credential the authenticator signed', async () => {
      const { authenticator, credential } = signedCredential();
      const sent = {
        ...credential,
        authenticatorAttachment: 'platform',
        clientExtensionResults: { credProps: { rk: true } },
      };

      const dto = await throughPipe({ passkeyResponse: sent });

      expect(dto.passkeyResponse).toEqual(sent);
      await expect(
        new WebAuthnAdapter().verifyAssertion(
          dto.passkeyResponse ?? credential,
          {
            id: authenticator.credentialId,
            publicKey: authenticator.cosePublicKey,
            counter: 0,
            transports: ['internal'],
          },
          EXPECTED,
        ),
      ).resolves.toEqual({ newCounter: 1, userVerified: true });
    });

    it('refuses a credential of another type', async () => {
      const { credential } = signedCredential();

      expect(
        await refusedFields({
          passkeyResponse: { ...credential, type: 'password' },
        }),
      ).toEqual(['passkeyResponse.type']);
    });
  });
  // feature:passkeys:end
});
