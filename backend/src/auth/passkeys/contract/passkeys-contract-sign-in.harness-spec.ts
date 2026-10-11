import {
  browser,
  CHALLENGE_LIFETIME_MS,
  credential,
  CREDENTIAL_ID,
  NOW,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  refusalOf,
  sha256,
  signInBrowser,
} from './passkeys-contract.harness-spec';

const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/** Signing in with a passkey, alone or as the answer to a second step. */
export function signInCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('opens a sign-in challenge for no account and asks for no credential in particular', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      createdAt: NOW,
    });
    services.storeCalls.length = 0;

    const options = await services.login.createOptions(browser().response);

    expect(options.data.challenge).toBe('contract-challenge-1');
    expect(services.authenticator.authenticationOptions).toEqual([
      { rpId: 'localhost', allowCredentials: [] },
    ]);
    expect(services.storeCalls).toEqual(['challenges.open']);
    expect(await harness().storedChallenges()).toEqual([
      {
        challengeHash: sha256('contract-challenge-1'),
        purpose: 'login',
        userId: null,
        expiresAt: at(CHALLENGE_LIFETIME_MS),
      },
    ]);
  });

  it('signs in a passkey that verified its user: counter and time of use stored, no second step', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 4,
      createdAt: NOW,
    });
    const holder = await signInBrowser(services);
    services.authenticator.assertion = { newCounter: 5, userVerified: true };

    const answer = await services.login.verify(
      { response: credential() },
      holder.request,
      holder.response,
    );

    expect(answer.data).toMatchObject({
      requiresTwoFactor: false,
      user: { id: ownerId },
    });
    expect(services.signIn).toMatchObject({
      issued: [ownerId],
      completed: [],
    });
    expect(services.authenticator.checkedAgainst).toEqual([
      {
        id: CREDENTIAL_ID,
        publicKey: Buffer.from([7, 7, 7]),
        counter: 4,
        transports: ['internal'],
      },
    ]);
    expect(services.authenticator.expectedChallenges).toEqual([
      'contract-challenge-1',
    ]);
    expect(await harness().storedPasskeys()).toMatchObject([
      { credentialId: CREDENTIAL_ID, counter: 5, lastUsedAt: NOW },
    ]);
    expect(await harness().storedChallenges()).toEqual([]);
    expect(holder.cookies).toEqual({});
  });

  it('runs the shared sign-in for a passkey that only proved possession, second step included', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 4,
      createdAt: NOW,
    });
    services.authenticator.assertion = { newCounter: 5, userVerified: false };

    const direct = await signInBrowser(services);
    const signedIn = await services.login.verify(
      { response: credential() },
      direct.request,
      direct.response,
    );
    expect(signedIn.data).toMatchObject({
      requiresTwoFactor: false,
      user: { id: ownerId },
    });

    services.signIn.owesSecondFactor = true;
    services.authenticator.assertion = { newCounter: 6, userVerified: false };
    const held = await signInBrowser(services);
    const owed = await services.login.verify(
      { response: credential() },
      held.request,
      held.response,
    );

    expect(owed.data).toEqual({ requiresTwoFactor: true, user: null });
    expect(services.signIn).toMatchObject({
      issued: [],
      completed: [ownerId, ownerId],
    });
  });

  it('answers the same, with the same work, for an unknown credential, a bad signature and a counter that did not move', async () => {
    const { ownerId } = fixture();
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 7,
      createdAt: NOW,
    });
    const attempts = [
      { sent: 'bm90LXJlZ2lzdGVyZWQ', assertion: null },
      { sent: CREDENTIAL_ID, assertion: null },
      {
        sent: CREDENTIAL_ID,
        assertion: { newCounter: 7, userVerified: true },
      },
    ];

    for (const attempt of attempts) {
      const services = passkeyServices(harness());
      const holder = await signInBrowser(services);
      services.authenticator.assertion = attempt.assertion;
      services.storeCalls.length = 0;

      const refused = await refusalOf(
        services.login.verify(
          { response: credential(attempt.sent) },
          holder.request,
          holder.response,
        ),
      );

      expect({
        refused,
        work: services.storeCalls,
        cookies: holder.cookies,
        challenges: await harness().storedChallenges(),
        signedIn: [...services.signIn.issued, ...services.signIn.completed],
      }).toEqual({
        refused: VERIFICATION_FAILED,
        work: ['challenges.consume', 'passkeys.findByCredentialId'],
        cookies: {},
        challenges: [],
        signedIn: [],
      });
    }
    expect(await harness().storedPasskeys()).toMatchObject([
      { credentialId: CREDENTIAL_ID, counter: 7, lastUsedAt: null },
    ]);
  });

  it('refuses the passkey of an account that is gone or deactivated, the same way', async () => {
    const { ownerId, otherId } = fixture();
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      counter: 4,
      createdAt: NOW,
    });
    await harness().seedPasskey({
      userId: otherId,
      credentialId: 'b3RoZXItYWNjb3VudA',
      counter: 4,
      createdAt: NOW,
    });
    await harness().removeAccount(ownerId);
    await harness().setDeleted(otherId, true);

    for (const sent of [CREDENTIAL_ID, 'b3RoZXItYWNjb3VudA']) {
      const services = passkeyServices(harness());
      const holder = await signInBrowser(services);
      services.authenticator.assertion = {
        newCounter: 5,
        userVerified: true,
      };
      services.storeCalls.length = 0;

      const refused = await refusalOf(
        services.login.verify(
          { response: credential(sent) },
          holder.request,
          holder.response,
        ),
      );

      expect({
        refused,
        work: services.storeCalls,
        signedIn: [...services.signIn.issued, ...services.signIn.completed],
      }).toEqual({
        refused: VERIFICATION_FAILED,
        work: [
          'challenges.consume',
          'passkeys.findByCredentialId',
          'passkeys.advanceCounter',
          'accounts.findAccount',
        ],
        signedIn: [],
      });
    }
  });
}
