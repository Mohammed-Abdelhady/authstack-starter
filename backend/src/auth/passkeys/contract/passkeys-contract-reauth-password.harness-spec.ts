import {
  browser,
  NOW,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  PASSWORD,
  refusalOf,
  sha256,
} from './passkeys-contract.harness-spec';
import { requirementOf } from './passkeys-contract-reauth.harness-spec';

const WEEK_MS = 604_800_000;

/** The proof asked before a passkey is added, for an account with a password. */
export function reauthPasswordCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('asks an account with a password for it however recent the sign-in, and opens no challenge without it', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    const recent = browser();

    const missing = await requirementOf(
      services.registration.createOptions(
        ownerId,
        {},
        recent.request,
        recent.response,
      ),
    );
    const wrong = await refusalOf(
      services.registration.createOptions(
        ownerId,
        { password: 'NotThePassword1!' },
        recent.request,
        recent.response,
      ),
    );

    expect(missing).toEqual({
      code: 'REAUTH_REQUIRED',
      status: 401,
      required: 'password',
    });
    expect(wrong).toEqual({ code: 'INVALID_CURRENT_PASSWORD', status: 400 });
    expect(await harness().storedChallenges()).toEqual([]);
    expect(services.authenticator.registrationOptions).toEqual([]);
  });

  it('hands out options for the right password on a session of any age', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    const weekOld = browser(
      {},
      { id: 'session-one', createdAt: new Date(NOW.getTime() - WEEK_MS) },
    );

    const options = await services.registration.createOptions(
      ownerId,
      { password: PASSWORD },
      weekOld.request,
      weekOld.response,
    );

    expect(options.data.challenge).toBe('contract-challenge-1');
    expect(await harness().storedChallenges()).toMatchObject([
      { challengeHash: sha256('contract-challenge-1'), userId: ownerId },
    ]);
  });
}
