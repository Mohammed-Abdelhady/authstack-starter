import { Logger } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { WebAuthnAdapter, type StoredCredential } from './webauthn.adapter';
import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  createSoftwareAuthenticator,
  signAssertion,
  toAssertionCredential,
  type CeremonyInput,
  type SoftwareAuthenticator,
} from './software-authenticator.harness-spec';

/**
 * The adapter against the real library, answered by a software authenticator
 * with a real P-256 signature. This is the only place the user verification
 * bit travels from signed authenticator data to `userVerified`.
 */

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3000';
const CHALLENGE = 'c2VydmVyLWNoYWxsZW5nZQ';
const EXPECTED = { challenge: CHALLENGE, origin: ORIGIN, rpId: RP_ID };
const CREDENTIAL_ID_BYTES = Buffer.from('software-credential');
const CREDENTIAL_ID = 'c29mdHdhcmUtY3JlZGVudGlhbA';
const STORED_COUNTER = 4;

const TOUCH: CeremonyInput = {
  rpId: RP_ID,
  origin: ORIGIN,
  challenge: CHALLENGE,
  flags: FLAG_USER_PRESENT,
  counter: 5,
};
const VERIFIED: CeremonyInput = {
  ...TOUCH,
  flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
};

describe('WebAuthnAdapter with a software authenticator', () => {
  const adapter = new WebAuthnAdapter();
  let authenticator: SoftwareAuthenticator;
  let stored: StoredCredential;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    authenticator = createSoftwareAuthenticator(CREDENTIAL_ID_BYTES);
    stored = {
      id: CREDENTIAL_ID,
      publicKey: authenticator.cosePublicKey,
      counter: STORED_COUNTER,
      transports: ['internal'],
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sign-in', () => {
    it('reports a touch without user verification as not verified', async () => {
      await expect(
        adapter.verifyAssertion(
          assertionCredential(authenticator, TOUCH),
          stored,
          EXPECTED,
        ),
      ).resolves.toEqual({ newCounter: 5, userVerified: false });
    });

    it('reports user verification when the authenticator signed the bit', async () => {
      await expect(
        adapter.verifyAssertion(
          assertionCredential(authenticator, VERIFIED),
          stored,
          EXPECTED,
        ),
      ).resolves.toEqual({ newCounter: 5, userVerified: true });
    });

    it('refuses user verification claimed without user presence', async () => {
      const credential = assertionCredential(authenticator, {
        ...TOUCH,
        flags: FLAG_USER_VERIFIED,
      });

      await expect(
        adapter.verifyAssertion(credential, stored, EXPECTED),
      ).resolves.toBeNull();
    });

    it('refuses a touch whose verification bit was set after signing', async () => {
      const signed = signAssertion(authenticator, TOUCH);
      const forged = Buffer.from(signed.authenticatorData);
      forged[32] = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;

      await expect(
        adapter.verifyAssertion(
          toAssertionCredential(authenticator, {
            ...signed,
            authenticatorData: forged,
          }),
          stored,
          EXPECTED,
        ),
      ).resolves.toBeNull();
    });

    it('refuses a signature made by another key', async () => {
      const stranger = {
        ...authenticator,
        privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' })
          .privateKey,
      };

      await expect(
        adapter.verifyAssertion(
          assertionCredential(stranger, VERIFIED),
          stored,
          EXPECTED,
        ),
      ).resolves.toBeNull();
    });

    it('refuses an assertion signed for another origin', async () => {
      const credential = assertionCredential(authenticator, {
        ...VERIFIED,
        origin: 'https://evil.example.com',
      });

      await expect(
        adapter.verifyAssertion(credential, stored, EXPECTED),
      ).resolves.toBeNull();
    });

    it('refuses an assertion signed for another relying party', async () => {
      const credential = assertionCredential(authenticator, {
        ...VERIFIED,
        rpId: 'evil.example.com',
      });

      await expect(
        adapter.verifyAssertion(credential, stored, EXPECTED),
      ).resolves.toBeNull();
    });

    it('refuses an assertion that answers another challenge', async () => {
      const credential = assertionCredential(authenticator, {
        ...VERIFIED,
        challenge: 'YW5vdGhlci1jaGFsbGVuZ2U',
      });

      await expect(
        adapter.verifyAssertion(credential, stored, EXPECTED),
      ).resolves.toBeNull();
    });

    it('refuses a touch without user verification when the caller requires it', async () => {
      await expect(
        adapter.verifyAssertion(
          assertionCredential(authenticator, TOUCH),
          stored,
          EXPECTED,
          'required',
        ),
      ).resolves.toBeNull();
    });

    it('accepts a verified assertion when the caller requires verification', async () => {
      await expect(
        adapter.verifyAssertion(
          assertionCredential(authenticator, VERIFIED),
          stored,
          EXPECTED,
          'required',
        ),
      ).resolves.toEqual({ newCounter: 5, userVerified: true });
    });

    it.each([
      ['behind the stored one', 3],
      ['equal to the stored one', 4],
    ])('refuses a counter %s', async (_label, counter) => {
      const credential = assertionCredential(authenticator, {
        ...VERIFIED,
        counter,
      });

      await expect(
        adapter.verifyAssertion(credential, stored, EXPECTED),
      ).resolves.toBeNull();
    });
  });
});
