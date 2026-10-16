import { Logger } from '@nestjs/common';
import { WebAuthnAdapter } from './webauthn.adapter';
import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  attestationCredential,
  createSoftwareAuthenticator,
  type CeremonyInput,
  type SoftwareAuthenticator,
} from './software-authenticator.harness-spec';

/**
 * Registration against the real library, answered by a software
 * authenticator. Origins are matched exactly: the list an application gives
 * is the whole of what is accepted.
 */

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3000';
const CHALLENGE = 'c2VydmVyLWNoYWxsZW5nZQ';
const EXPECTED = { challenge: CHALLENGE, origin: ORIGIN, rpId: RP_ID };
const REGISTRATION = {
  challenge: CHALLENGE,
  origins: [ORIGIN],
  rpId: RP_ID,
  userVerification: 'preferred' as const,
};
const ANDROID_ORIGIN = 'android:apk-key-hash:Q29uZmlndXJlZC1rZXktaGFzaA';
const CREDENTIAL_ID_BYTES = Buffer.from('software-credential');
const CREDENTIAL_ID = 'c29mdHdhcmUtY3JlZGVudGlhbA';

const TOUCH: CeremonyInput = {
  rpId: RP_ID,
  origin: ORIGIN,
  challenge: CHALLENGE,
  flags: FLAG_USER_PRESENT,
  counter: 0,
};
const VERIFIED: CeremonyInput = {
  ...TOUCH,
  flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
};

describe('WebAuthnAdapter registration with a software authenticator', () => {
  const adapter = new WebAuthnAdapter();
  let authenticator: SoftwareAuthenticator;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    authenticator = createSoftwareAuthenticator(CREDENTIAL_ID_BYTES);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const REGISTERED = {
    credentialId: CREDENTIAL_ID,
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
  };

  it.each([
    ['without user verification', FLAG_USER_PRESENT, false],
    ['with user verification', FLAG_USER_PRESENT | FLAG_USER_VERIFIED, true],
  ])('accepts an unattested key %s', async (_label, flags, userVerified) => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      flags,
      counter: 0,
    });

    const result = await adapter.verifyAttestation(credential, REGISTRATION);

    expect(result).toEqual({
      ...REGISTERED,
      publicKey: authenticator.cosePublicKey,
      userVerified,
    });
  });

  it('refuses a registration without user verification when the caller requires it', async () => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
    });

    await expect(
      adapter.verifyAttestation(credential, {
        ...REGISTRATION,
        userVerification: 'required',
      }),
    ).resolves.toBeNull();
  });

  it('refuses a registration made on another origin', async () => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
      origin: 'https://evil.example.com',
    });

    await expect(
      adapter.verifyAttestation(credential, REGISTRATION),
    ).resolves.toBeNull();
  });

  it.each([
    ['a subdomain of the relying party', 'https://app.localhost'],
    ['a sibling port of the listed origin', 'http://localhost:3001'],
  ])('matches origins exactly and refuses %s', async (_label, origin) => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
      origin,
    });

    await expect(
      adapter.verifyAttestation(credential, REGISTRATION),
    ).resolves.toBeNull();
  });

  it('accepts an Android key hash in the list and refuses another key hash', async () => {
    const expected = { ...REGISTRATION, origins: [ORIGIN, ANDROID_ORIGIN] };
    const fromApp = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
      origin: ANDROID_ORIGIN,
    });
    const fromOtherBuild = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
      origin: 'android:apk-key-hash:T3RoZXIta2V5LWhhc2g',
    });

    await expect(
      adapter.verifyAttestation(fromApp, expected),
    ).resolves.toMatchObject({ credentialId: CREDENTIAL_ID });
    await expect(
      adapter.verifyAttestation(fromOtherBuild, expected),
    ).resolves.toBeNull();
  });

  it('refuses a registration made for another relying party', async () => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
      rpId: 'evil.example.com',
    });

    await expect(
      adapter.verifyAttestation(credential, REGISTRATION),
    ).resolves.toBeNull();
  });

  it('refuses a registration that answers another challenge', async () => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
      challenge: 'YW5vdGhlci1jaGFsbGVuZ2U',
    });

    await expect(
      adapter.verifyAttestation(credential, REGISTRATION),
    ).resolves.toBeNull();
  });

  it('asks a challenge check, and refuses what it refuses', async () => {
    const credential = attestationCredential(authenticator, {
      ...TOUCH,
      counter: 0,
    });
    const asked: string[] = [];
    const check = (accept: boolean) => (challenge: string) => {
      asked.push(challenge);
      return accept;
    };

    await expect(
      adapter.verifyAttestation(credential, {
        ...REGISTRATION,
        challenge: check(false),
      }),
    ).resolves.toBeNull();
    await expect(
      adapter.verifyAttestation(credential, {
        ...REGISTRATION,
        challenge: check(true),
      }),
    ).resolves.toMatchObject({ credentialId: CREDENTIAL_ID });
    expect(asked).toEqual([CHALLENGE, CHALLENGE]);
  });

  it('stores a key the same authenticator can then sign in with', async () => {
    const registered = await adapter.verifyAttestation(
      attestationCredential(authenticator, { ...TOUCH, counter: 0 }),
      REGISTRATION,
    );

    const assertion = await adapter.verifyAssertion(
      assertionCredential(authenticator, { ...VERIFIED, counter: 1 }),
      {
        id: registered?.credentialId ?? '',
        publicKey: registered?.publicKey ?? Buffer.alloc(0),
        counter: registered?.counter ?? -1,
        transports: registered?.transports ?? [],
      },
      EXPECTED,
    );

    expect(assertion).toEqual({ newCounter: 1, userVerified: true });
  });
});
