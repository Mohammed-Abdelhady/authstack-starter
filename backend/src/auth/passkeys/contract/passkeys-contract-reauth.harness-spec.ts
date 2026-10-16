import { AppException } from '../../../common/exceptions/app.exception';
import {
  attestationOf,
  browser,
  BrowserSession,
  CHALLENGE_COOKIE,
  credential,
  NOW,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  PASSWORD,
  refusalOf,
  SESSION,
  sha256,
} from './passkeys-contract.harness-spec';

/** Written out, so a changed constant cannot agree with itself. */
const RECENT_SIGN_IN_MS = 300_000;
const SIGN_IN_AGAIN = {
  code: 'REAUTH_REQUIRED',
  status: 401,
  required: 'recent_sign_in',
};
const CHALLENGE_INVALID = { code: 'PASSKEY_CHALLENGE_INVALID', status: 401 };

/** A session that started this long before the frozen time. */
function startedAgo(ageMs: number, id = 'session-one'): BrowserSession {
  return { ...SESSION, id, createdAt: new Date(NOW.getTime() - ageMs) };
}

/** Awaits a promise that must be refused and hands back how, with what it asked for. */
export async function requirementOf(
  promise: Promise<unknown>,
): Promise<{ code: string; status: number; required: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return {
        code: error.code,
        status: error.getStatus(),
        required: error.getDetails()?.required,
      };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

/**
 * The proof asked before a passkey is added, for accounts that have nothing
 * to type, and the tie between that proof and the challenge it earns.
 */
export function reauthCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('hands an account without a password its options on a sign-in five minutes old, and refuses one a millisecond older', async () => {
    const services = passkeyServices(harness());
    const passwordless = await harness().seedAccount({
      email: 'passwordless@example.test',
    });
    const tooOld = browser({}, startedAgo(RECENT_SIGN_IN_MS + 1));
    const signedOut = browser({}, null);
    const atTheLimit = browser({}, startedAgo(RECENT_SIGN_IN_MS));

    const refused = await requirementOf(
      services.registration.createOptions(
        passwordless,
        {},
        tooOld.request,
        tooOld.response,
      ),
    );
    const refusedSignedOut = await requirementOf(
      services.registration.createOptions(
        passwordless,
        {},
        signedOut.request,
        signedOut.response,
      ),
    );
    const storedAfterRefusals = await harness().storedChallenges();
    const options = await services.registration.createOptions(
      passwordless,
      {},
      atTheLimit.request,
      atTheLimit.response,
    );

    expect({ refused, refusedSignedOut }).toEqual({
      refused: SIGN_IN_AGAIN,
      refusedSignedOut: SIGN_IN_AGAIN,
    });
    // A refused request gets no challenge to answer: none stored, none sent.
    expect(storedAfterRefusals).toEqual([]);
    expect(tooOld.cookies[CHALLENGE_COOKIE]).toBeUndefined();
    expect(services.authenticator.registrationOptions).toHaveLength(1);
    expect(options.data.challenge).toBe('contract-challenge-1');
    expect(await harness().storedChallenges()).toMatchObject([
      { challengeHash: sha256('contract-challenge-1'), userId: passwordless },
    ]);
  });

  it('treats a stored password as none while password sign-in is off: a recent sign-in is asked for, and the password proves nothing', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness(), { password: false });
    const old = browser({}, startedAgo(RECENT_SIGN_IN_MS + 1));
    const recent = browser();

    const withThePassword = await requirementOf(
      services.registration.createOptions(
        ownerId,
        { password: PASSWORD },
        old.request,
        old.response,
      ),
    );
    await services.registration.createOptions(
      ownerId,
      { password: 'NotThePassword1!' },
      recent.request,
      recent.response,
    );

    expect(withThePassword).toEqual(SIGN_IN_AGAIN);
    expect(await harness().storedChallenges()).toHaveLength(1);
  });

  it('takes a challenge only from the session that proved itself for it', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    services.authenticator.attestation = attestationOf();
    const answerFrom = async (
      session: BrowserSession | null,
    ): Promise<unknown> => {
      const asked = browser();
      await services.registration.createOptions(
        ownerId,
        { password: PASSWORD },
        asked.request,
        asked.response,
      );
      // The same cookie, sent on another session of the same account.
      const answering = browser(asked.cookies, session);
      return services.registration.verify(
        ownerId,
        { response: credential() },
        answering.request,
        answering.response,
      );
    };

    const anotherSession = await refusalOf(
      answerFrom({ ...SESSION, id: 'session-two' }),
    );
    const noSession = await refusalOf(answerFrom(null));
    const storedAfterRefusals = await harness().storedPasskeys();
    await answerFrom(SESSION);

    expect({ anotherSession, noSession }).toEqual({
      anotherSession: CHALLENGE_INVALID,
      noSession: CHALLENGE_INVALID,
    });
    expect(storedAfterRefusals).toEqual([]);
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  it('refuses a challenge that names no session, as one issued before the proof was asked for would, with a session or without', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    services.authenticator.attestation = attestationOf();
    const answerOn = async (
      session: BrowserSession | null,
      challenge: string,
    ): Promise<unknown> => {
      const holder = browser({}, session);
      await services.challenge.issue(
        holder.response,
        'register',
        challenge,
        ownerId,
      );
      return services.registration.verify(
        ownerId,
        { response: credential() },
        holder.request,
        holder.response,
      );
    };

    const signedIn = await refusalOf(answerOn(SESSION, 'unnamed-one'));
    const signedOut = await refusalOf(answerOn(null, 'unnamed-two'));

    expect({ signedIn, signedOut }).toEqual({
      signedIn: CHALLENGE_INVALID,
      signedOut: CHALLENGE_INVALID,
    });
    expect(await harness().storedPasskeys()).toEqual([]);
  });
}
