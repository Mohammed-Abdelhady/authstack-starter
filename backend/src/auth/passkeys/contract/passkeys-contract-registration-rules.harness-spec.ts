import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  attestationOf,
  browser,
  credential,
  CREDENTIAL_ID,
  NOW,
  OTHER_CREDENTIAL_ID,
  outcomeOf,
  PasskeysFixture,
  PasskeysHarnessSource,
  passkeyServices,
  refusalOf,
  registrationBrowser,
  sha256,
} from './passkeys-contract.harness-spec';

const CHALLENGE_INVALID = { code: 'PASSKEY_CHALLENGE_INVALID', status: 401 };
const VERIFICATION_FAILED = {
  code: 'PASSKEY_VERIFICATION_FAILED',
  status: 401,
};

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/** A registration challenge works once and lapses. A credential belongs to one passkey. */
export function registrationRuleCases(
  harness: PasskeysHarnessSource,
  fixture: () => PasskeysFixture,
): void {
  it('stores one passkey when two requests answer one registration challenge at once', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    services.authenticator.attestation = attestationOf();
    const holder = await registrationBrowser(services, ownerId);
    const copy = browser(holder.cookies);
    const gate = new RaceGate();
    const restore = holdBefore(harness().challenges, 'consume', () => gate);

    const attempts = [holder, copy].map((from) =>
      outcomeOf(
        services.registration.verify(
          ownerId,
          { response: credential() },
          from.request,
          from.response,
        ),
      ),
    );
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual(['PASSKEY_CHALLENGE_INVALID', 'accepted']);
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  it('refuses a registration challenge at its expiry though its row is stored, and takes it a millisecond earlier', async () => {
    const { ownerId } = fixture();
    const services = passkeyServices(harness());
    const { clock } = harness();
    services.authenticator.attestation = attestationOf();
    const holder = await registrationBrowser(services, ownerId);
    const hash = sha256('contract-challenge-1');
    // The row lapses long before the cookie, so only the stored expiry decides.
    await harness().setChallengeExpiry(hash, at(1000));
    const copy = browser(holder.cookies);

    clock.set(at(1000));
    expect(
      await refusalOf(
        services.registration.verify(
          ownerId,
          { response: credential() },
          holder.request,
          holder.response,
        ),
      ),
    ).toEqual(CHALLENGE_INVALID);
    expect(await harness().storedChallenges()).toMatchObject([
      { challengeHash: hash, expiresAt: at(1000) },
    ]);
    expect(await harness().storedPasskeys()).toEqual([]);

    clock.set(at(999));
    await services.registration.verify(
      ownerId,
      { response: credential() },
      copy.request,
      copy.response,
    );
    expect(await harness().storedPasskeys()).toHaveLength(1);
  });

  it('refuses a credential another passkey already has, at the check and at the insert', async () => {
    const { ownerId, otherId } = fixture();
    const services = passkeyServices(harness());
    await harness().seedPasskey({
      userId: otherId,
      credentialId: CREDENTIAL_ID,
      createdAt: NOW,
    });
    services.authenticator.attestation = attestationOf();

    const holder = await registrationBrowser(services, ownerId);
    expect(
      await refusalOf(
        services.registration.verify(
          ownerId,
          { response: credential() },
          holder.request,
          holder.response,
        ),
      ),
    ).toEqual(VERIFICATION_FAILED);

    // Two registrations of one new credential pass the check together.
    services.authenticator.attestation = attestationOf(OTHER_CREDENTIAL_ID);
    const first = await registrationBrowser(services, ownerId);
    const second = await registrationBrowser(services, otherId);
    const gate = new RaceGate();
    const restore = holdBefore(harness().passkeys, 'insert', () => gate);
    const attempts = [
      outcomeOf(
        services.registration.verify(
          ownerId,
          { response: credential(OTHER_CREDENTIAL_ID) },
          first.request,
          first.response,
        ),
      ),
      outcomeOf(
        services.registration.verify(
          otherId,
          { response: credential(OTHER_CREDENTIAL_ID) },
          second.request,
          second.response,
        ),
      ),
    ];
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual(['UniqueConflictError', 'accepted']);
    expect(
      (await harness().storedPasskeys()).map((passkey) => passkey.credentialId),
    ).toEqual([CREDENTIAL_ID, OTHER_CREDENTIAL_ID].sort());
  });
}
