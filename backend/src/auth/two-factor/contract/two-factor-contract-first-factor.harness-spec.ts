import { createHash, createHmac } from 'node:crypto';
import { SecondFactorVerifier } from '../services/second-factor-verifiers';
import {
  browser,
  Browser,
  CHALLENGE_COOKIE,
  challengedBrowser,
  codeAt,
  refusalOf,
  seedEnabled,
  TOTP_SECRET,
  twoFactorCase,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  TwoFactorServices,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const CHALLENGE_INVALID = {
  code: 'TWO_FACTOR_CHALLENGE_INVALID',
  status: 401,
};

interface CookiePayload {
  sub: string;
  nonce: string;
  expiresAt: number;
  firstFactor?: string;
}

function payloadOf(holder: Browser): CookiePayload {
  const [encoded] = holder.cookies[CHALLENGE_COOKIE].split('.');
  const payload: unknown = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  return payload as CookiePayload;
}

/** A cookie with another payload under a signature the server accepts. */
function signedAgain(services: TwoFactorServices, payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', services.crypto.challengeKey())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

/** What a held sign-in remembers of its first step, and who may say so. */
export function firstFactorCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  twoFactorCase(
    'carries the first factor a route gave from the cookie to the verifier',
    async () => {
      const { ownerId } = fixture();
      const seen: unknown[] = [];
      const verifier: SecondFactorVerifier = {
        supports: (dto) => dto.code === undefined,
        verify: (_dto, _account, _request, _response, attempt) => {
          seen.push(attempt);
          return Promise.resolve();
        },
      };
      const services = twoFactorServices(harness(), [verifier]);
      await seedEnabled(harness(), services.crypto, ownerId);

      const named = await challengedBrowser(services, ownerId, 'passkey');
      const { nonce, firstFactor } = payloadOf(named);
      expect(firstFactor).toBe('passkey');
      expect(await harness().storedChallenges()).toMatchObject([
        {
          nonceHash: createHash('sha256')
            .update(`${nonce}.passkey`)
            .digest('hex'),
        },
      ]);
      await services.login.verify({}, named.request, named.response);

      const unnamed = await challengedBrowser(services, ownerId);
      await services.login.verify({}, unnamed.request, unnamed.response);

      expect(seen).toEqual([
        { firstFactor: 'passkey' },
        { firstFactor: 'password' },
      ]);
    },
  );

  twoFactorCase(
    'refuses a cookie signed again to name another first factor, none, or an unknown one',
    async () => {
      const { ownerId } = fixture();
      const services = twoFactorServices(harness());
      const { clock } = harness();
      await seedEnabled(harness(), services.crypto, ownerId);
      const held = await challengedBrowser(services, ownerId, 'passkey');
      const { sub, nonce, expiresAt } = payloadOf(held);
      const code = codeAt(clock, TOTP_SECRET);
      const refusalWith = (payload: object): Promise<unknown> => {
        const forged = browser({
          [CHALLENGE_COOKIE]: signedAgain(services, payload),
        });
        return refusalOf(
          services.login.verify({ code }, forged.request, forged.response),
        );
      };

      // Well formed, so it is looked up, and no challenge is stored under it.
      expect(
        await refusalWith({ sub, nonce, expiresAt, firstFactor: 'password' }),
      ).toEqual(CHALLENGE_INVALID);

      // Not a first factor at all: refused before anything is read.
      services.storeCalls.length = 0;
      for (const payload of [
        { sub, nonce, expiresAt },
        { sub, nonce, expiresAt, firstFactor: 'fingerprint' },
        { sub, nonce, expiresAt, firstFactor: null },
      ]) {
        expect(await refusalWith(payload)).toEqual(CHALLENGE_INVALID);
      }
      expect(services.storeCalls).toEqual([]);
      expect(await harness().storedChallenges()).toMatchObject([
        { userId: ownerId, attempts: 0, claimed: false },
      ]);
      expect(services.signIn.accountIds).toEqual([]);

      // The cookie as issued still answers, and a code from the app is a
      // second factor after a passkey.
      await services.login.verify({ code }, held.request, held.response);
      expect(services.signIn.accountIds).toEqual([ownerId]);
    },
  );
}
