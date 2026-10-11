import {
  attestationOf,
  browser,
  CHALLENGE_COOKIE,
  CHALLENGE_LIFETIME_MS,
  credential,
  CREDENTIAL_ID,
  DEFAULT_NAME,
  NOW,
  OTHER_CREDENTIAL_ID,
  OWNER_EMAIL,
  passkeyCase,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  PASSWORD,
  refusalOf,
  registrationBrowser,
  sha256,
} from './passkeys-contract.harness-spec';

const CHALLENGE_INVALID = { code: 'PASSKEY_CHALLENGE_INVALID', status: 401 };
const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};
const NOT_FOUND = { code: 'USER_NOT_FOUND', status: 404 };

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/** Adding a passkey to an account that is signed in. */
export function registrationCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  passkeyCase(
    'opens a registration challenge for the account and leaves out the credentials it has',
    async () => {
      const { ownerId, otherId } = fixture();
      const services = passkeyServices(harness());
      await harness().seedPasskey({
        userId: ownerId,
        credentialId: CREDENTIAL_ID,
        createdAt: NOW,
      });
      await harness().seedPasskey({
        userId: otherId,
        credentialId: OTHER_CREDENTIAL_ID,
        createdAt: NOW,
      });
      const holder = browser();

      const options = await services.registration.createOptions(
        ownerId,
        { password: PASSWORD },
        holder.request,
        holder.response,
      );

      expect(options.data.challenge).toBe('contract-challenge-1');
      expect(services.authenticator.registrationOptions).toEqual([
        {
          rpId: 'localhost',
          rpName: 'Contract',
          userId: ownerId,
          userName: OWNER_EMAIL,
          userDisplayName: 'Contract Tester',
          excludeCredentials: [{ id: CREDENTIAL_ID, transports: ['internal'] }],
        },
      ]);
      expect(await harness().storedChallenges()).toEqual([
        {
          challengeHash: sha256('contract-challenge-1'),
          purpose: 'register',
          userId: ownerId,
          expiresAt: at(CHALLENGE_LIFETIME_MS),
        },
      ]);
      expect(holder.cookies[CHALLENGE_COOKIE]).toEqual(expect.any(String));
    },
  );

  passkeyCase(
    'opens no challenge for an account that is absent or deactivated',
    async () => {
      const { ownerId } = fixture();
      const services = passkeyServices(harness());
      await harness().setDeleted(ownerId, true);

      for (const userId of [harness().absentId(), ownerId]) {
        expect(
          await refusalOf(
            services.registration.createOptions(
              userId,
              { password: PASSWORD },
              browser().request,
              browser().response,
            ),
          ),
        ).toEqual(NOT_FOUND);
      }
      expect(await harness().storedChallenges()).toEqual([]);
    },
  );

  passkeyCase(
    'stores a verified credential as the library reported it and spends the challenge',
    async () => {
      const { ownerId } = fixture();
      const services = passkeyServices(harness());
      const holder = await registrationBrowser(services, ownerId);
      services.authenticator.attestation = attestationOf();

      const added = await services.registration.verify(
        ownerId,
        { response: credential(), name: '  Work laptop ' },
        holder.request,
        holder.response,
      );

      const stored = await harness().storedPasskeys();
      expect(stored).toEqual([
        {
          id: added.data.id,
          userId: ownerId,
          credentialId: CREDENTIAL_ID,
          publicKey: Buffer.from([0, 255, 1, 128]),
          counter: 0,
          transports: ['internal', 'hybrid'],
          deviceType: 'multiDevice',
          backedUp: true,
          name: 'Work laptop',
          lastUsedAt: null,
        },
      ]);
      expect(added.data).toMatchObject({
        name: 'Work laptop',
        deviceType: 'multiDevice',
        backedUp: true,
        lastUsedAt: null,
      });
      expect(added.data.createdAt).toBeInstanceOf(Date);
      expect(services.authenticator.expectedChallenges).toEqual([
        'contract-challenge-1',
      ]);
      expect(await harness().storedChallenges()).toEqual([]);
      expect(holder.cookies).toEqual({});
      expect(await harness().profilePasskeyCount(ownerId)).toBe(1);
    },
  );

  passkeyCase(
    'names a passkey that came with no name or a blank one',
    async () => {
      const { ownerId } = fixture();
      const services = passkeyServices(harness());

      const unnamed = await registrationBrowser(services, ownerId);
      services.authenticator.attestation = attestationOf(CREDENTIAL_ID);
      await services.registration.verify(
        ownerId,
        { response: credential() },
        unnamed.request,
        unnamed.response,
      );
      const blank = await registrationBrowser(services, ownerId);
      services.authenticator.attestation = attestationOf(OTHER_CREDENTIAL_ID);
      await services.registration.verify(
        ownerId,
        { response: credential(OTHER_CREDENTIAL_ID), name: '   ' },
        blank.request,
        blank.response,
      );

      expect(
        (await harness().storedPasskeys()).map((passkey) => passkey.name),
      ).toEqual([DEFAULT_NAME, DEFAULT_NAME]);
    },
  );

  passkeyCase(
    'stores nothing and still spends the challenge when the account or the attestation is wrong',
    async () => {
      const { ownerId, otherId } = fixture();
      const services = passkeyServices(harness());
      services.authenticator.attestation = attestationOf();

      const stolen = await registrationBrowser(services, ownerId);
      expect(
        await refusalOf(
          services.registration.verify(
            otherId,
            { response: credential() },
            stolen.request,
            stolen.response,
          ),
        ),
      ).toEqual(CHALLENGE_INVALID);
      expect(await harness().storedChallenges()).toEqual([]);

      const unsigned = await registrationBrowser(services, ownerId);
      services.authenticator.attestation = null;
      expect(
        await refusalOf(
          services.registration.verify(
            ownerId,
            { response: credential() },
            unsigned.request,
            unsigned.response,
          ),
        ),
      ).toEqual(VERIFICATION_FAILED);

      expect(await harness().storedChallenges()).toEqual([]);
      expect(await harness().storedPasskeys()).toEqual([]);
      expect(unsigned.cookies).toEqual({});
    },
  );

  passkeyCase(
    'refuses a sign-in challenge, a missing cookie and a challenge used before',
    async () => {
      const { ownerId } = fixture();
      const services = passkeyServices(harness());
      services.authenticator.attestation = attestationOf();
      const verify = (request: ReturnType<typeof browser>): Promise<unknown> =>
        services.registration.verify(
          ownerId,
          { response: credential() },
          request.request,
          request.response,
        );

      const forSignIn = browser();
      await services.login.createOptions(forSignIn.response);
      expect(await refusalOf(verify(forSignIn))).toEqual(CHALLENGE_INVALID);
      expect(await refusalOf(verify(browser()))).toEqual(CHALLENGE_INVALID);
      expect(await harness().storedPasskeys()).toEqual([]);

      const holder = await registrationBrowser(services, ownerId);
      const copy = browser(holder.cookies);
      await verify(holder);
      services.authenticator.attestation = attestationOf(OTHER_CREDENTIAL_ID);
      expect(await refusalOf(verify(copy))).toEqual(CHALLENGE_INVALID);

      expect(
        (await harness().storedPasskeys()).map(
          (passkey) => passkey.credentialId,
        ),
      ).toEqual([CREDENTIAL_ID]);
    },
  );
}
