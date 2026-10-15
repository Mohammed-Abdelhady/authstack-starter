import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  attestationOf,
  CREDENTIAL_ID,
  NOW,
  OTHER_CREDENTIAL_ID,
  outcomeOf,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  refusalOf,
} from './passkeys-contract.harness-spec';
import {
  APP_ORIGIN,
  APP_RP_ID,
  appCredential,
  APP_CLIENT_ID,
  appSession,
  FIVE_MINUTES_MS,
  nativeChallengeHash,
  nativeRegistration,
  PLAIN_CLIENT_ID,
} from './passkeys-contract-native.harness-spec';

const CHALLENGE_INVALID = { code: 'PASSKEY_CHALLENGE_INVALID', status: 401 };
const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};
const SIGN_IN_AGAIN = { code: 'REAUTH_REQUIRED', status: 401 };
const SESSION = 'native-session-one';
const OTHER_SESSION = 'native-session-two';

/** Adding a passkey from a signed-in app: no cookie, a stored digest per session. */
export function nativeRegistrationCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  function setUp() {
    const services = passkeyServices(harness());
    services.authenticator.attestation = attestationOf();
    return { services, native: nativeRegistration(harness(), services) };
  }

  it('opens a challenge bound to the session for a sign-in exactly five minutes old, and excludes only that relying party', async () => {
    const { ownerId } = fixture();
    const { services, native } = setUp();
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: CREDENTIAL_ID,
      createdAt: NOW,
    });
    await harness().seedPasskey({
      userId: ownerId,
      credentialId: OTHER_CREDENTIAL_ID,
      createdAt: NOW,
      rpId: APP_RP_ID,
    });

    const options = await native.createOptions(
      ownerId,
      appSession(SESSION, FIVE_MINUTES_MS),
    );

    expect(services.authenticator.registrationOptions).toMatchObject([
      {
        rpId: APP_RP_ID,
        userId: ownerId,
        excludeCredentials: [
          { id: OTHER_CREDENTIAL_ID, transports: ['internal'] },
        ],
        userVerification: 'required',
      },
    ]);
    expect(await harness().storedChallenges()).toEqual([
      {
        challengeHash: nativeChallengeHash(
          SESSION,
          ownerId,
          options.data.challenge,
        ),
        purpose: 'nativeRegister',
        userId: ownerId,
        expiresAt: new Date(NOW.getTime() + FIVE_MINUTES_MS),
      },
    ]);
  });

  it('refuses options to a sign-in a millisecond past five minutes with the reauthentication error, opening nothing', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();

    expect(
      await refusalOf(
        native.createOptions(ownerId, appSession(SESSION, FIVE_MINUTES_MS + 1)),
      ),
    ).toEqual(SIGN_IN_AGAIN);
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('reads the sign-in time, not the session row time: a session stored just now on a sign-in six minutes old is refused', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();
    const storedNowSignedInEarlier = {
      ...appSession(SESSION, FIVE_MINUTES_MS + 60_000),
      createdAt: NOW,
    };

    expect(
      await refusalOf(native.createOptions(ownerId, storedNowSignedInEarlier)),
    ).toEqual(SIGN_IN_AGAIN);
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('stores the passkey under the app relying party, checked against the app origins, and spends the challenge', async () => {
    const { ownerId } = fixture();
    const { services, native } = setUp();
    const options = await native.createOptions(ownerId, appSession(SESSION));

    const added = await native.verify(ownerId, appSession(SESSION), {
      response: appCredential(options.data.challenge),
      name: ' Phone ',
    });

    expect(added.data.name).toBe('Phone');
    expect(services.authenticator.attestationTargets).toEqual([
      { rpId: APP_RP_ID, origins: [APP_ORIGIN], userVerification: 'required' },
    ]);
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: CREDENTIAL_ID, rpId: APP_RP_ID },
    ]);
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('refuses a replayed challenge, one handed to another session of the account, and one at its expiry', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();

    const used = await native.createOptions(ownerId, appSession(SESSION));
    const replay = appCredential(used.data.challenge);
    await native.verify(ownerId, appSession(SESSION), { response: replay });
    expect(
      await refusalOf(
        native.verify(ownerId, appSession(SESSION), { response: replay }),
      ),
    ).toEqual(CHALLENGE_INVALID);

    const theirs = await native.createOptions(ownerId, appSession(SESSION));
    expect(
      await refusalOf(
        native.verify(ownerId, appSession(OTHER_SESSION), {
          response: appCredential(theirs.data.challenge, OTHER_CREDENTIAL_ID),
        }),
      ),
    ).toEqual(CHALLENGE_INVALID);
    // The other session spent nothing: the row is still the first session's.
    expect(await harness().storedChallenges()).toHaveLength(1);

    harness().clock.set(new Date(NOW.getTime() + FIVE_MINUTES_MS));
    expect(
      await refusalOf(
        native.verify(ownerId, appSession(SESSION), {
          response: appCredential(theirs.data.challenge, OTHER_CREDENTIAL_ID),
        }),
      ),
    ).toEqual(CHALLENGE_INVALID);
    expect(await harness().storedRelyingParties()).toEqual([
      { credentialId: CREDENTIAL_ID, rpId: APP_RP_ID },
    ]);
  });

  it('stores one passkey when two verifies answer one challenge at once', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();
    const options = await native.createOptions(ownerId, appSession(SESSION));
    const gate = new RaceGate();
    const restore = holdBefore(harness().challenges, 'consume', () => gate);

    const attempts = [0, 1].map(() =>
      outcomeOf(
        native.verify(ownerId, appSession(SESSION), {
          response: appCredential(options.data.challenge),
        }),
      ),
    );
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual(['PASSKEY_CHALLENGE_INVALID', 'accepted']);
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  it('stores nothing for an account deactivated between options and verify', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();
    const options = await native.createOptions(ownerId, appSession(SESSION));
    await harness().setDeleted(ownerId, true);

    expect(
      await refusalOf(
        native.verify(ownerId, appSession(SESSION), {
          response: appCredential(options.data.challenge),
        }),
      ),
    ).toEqual(VERIFICATION_FAILED);
    expect(await harness().storedPasskeys()).toEqual([]);
  });

  it('refuses client data that names no challenge without spending the stored one', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();
    await native.createOptions(ownerId, appSession(SESSION));
    const unreadable = {
      ...appCredential('unused'),
      response: { clientDataJSON: 'bm90IGpzb24' },
    };

    for (const response of [unreadable, { ...unreadable, response: {} }]) {
      expect(
        await refusalOf(
          native.verify(ownerId, appSession(SESSION), { response }),
        ),
      ).toEqual(CHALLENGE_INVALID);
    }
    expect(await harness().storedChallenges()).toHaveLength(1);
    expect(await harness().storedPasskeys()).toEqual([]);
  });

  it('refuses options for an app with no native relying party and for a browser session', async () => {
    const { ownerId } = fixture();
    const { native } = setUp();
    // A session with no purpose recorded reads as a browser one.
    const browserSession = {
      id: SESSION,
      createdAt: NOW,
      authenticatedAt: NOW,
      clientId: APP_CLIENT_ID,
    };

    expect(
      await refusalOf(
        native.createOptions(ownerId, appSession(SESSION, 0, PLAIN_CLIENT_ID)),
      ),
    ).toEqual({ code: 'FEATURE_DISABLED', status: 404 });
    expect(
      await refusalOf(native.createOptions(ownerId, browserSession)),
    ).toEqual({ code: 'FORBIDDEN', status: 403 });
    expect(await harness().storedChallenges()).toEqual([]);
  });
}
