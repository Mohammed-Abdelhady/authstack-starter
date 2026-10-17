import { ADDRESS_CLAIM_KIND } from '../../../../src/common/persistence/address-ledger';
import { FRESH_PROOF_KIND } from '../../../../src/auth/contracts/constants/fresh-proof';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import {
  AccountsFixture,
  AccountsHarnessSource,
  refusalOf,
  revocationsOf,
  storedAccount,
} from './accounts-contract-support';
import {
  browserCaller,
  codeMailedTo,
  ownEmailServicesOn,
} from './accounts-contract-own-email-support';

const FIRST_ADDRESS = 'own-first@example.test';
const SECOND_ADDRESS = 'own-second@example.test';
const CODE_INVALID = { code: 'ACTIVATION_CODE_INVALID', status: 400 };

/**
 * A person's own address change on this database: what a request, a second
 * request, a cancel and a confirm leave stored.
 */
export function accountOwnEmailCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('reads an explicit stored act only for its account, session and application', async () => {
    const h = harness();
    const { userId } = fixture();
    const own = ownEmailServicesOn(h);
    const caller = await browserCaller(h, userId);
    caller.signedInAt = new Date(h.clock.now().getTime() - 6 * 60_000);
    const otherSession = await browserCaller(h, userId);
    await h.runner(rerunAtOnce).run((work) =>
      h.proofs.recordProof(work, {
        userId,
        sessionId: caller.sessionId,
        clientId: caller.clientId,
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
        userVerified: false,
        provedAt: h.clock.now(),
        purgeAfter: new Date(h.clock.now().getTime() + 600_000),
      }),
    );
    await expect(
      own.requests.request(
        { ...caller, sessionId: otherSession.sessionId },
        FIRST_ADDRESS,
      ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(await h.claims()).toEqual([]);
    await own.requests.request(caller, FIRST_ADDRESS);
    expect(await storedAccount(h, userId)).toMatchObject({
      pendingEmail: FIRST_ADDRESS,
    });
    h.clock.set(new Date(h.clock.now().getTime() + 5 * 60_000 + 1));
    await expect(
      own.requests.request(caller, SECOND_ADDRESS),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(await storedAccount(h, userId)).toMatchObject({
      pendingEmail: FIRST_ADDRESS,
    });
  });

  it('stores the address the account asks for, its claim and its code, at the next generation', async () => {
    const { userId } = fixture();
    const own = ownEmailServicesOn(harness());
    const caller = await browserCaller(harness(), userId);

    await own.requests.request(caller, FIRST_ADDRESS);

    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: FIRST_ADDRESS,
      addressGeneration: 1,
    });
    expect(await harness().claims()).toEqual([
      expect.objectContaining({
        address: FIRST_ADDRESS,
        owner: userId,
        kind: ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE,
      }),
    ]);
    expect(await harness().pendingRegistrations(FIRST_ADDRESS)).toBe(1);
  });

  it('frees the first address for a second request, and both when the change is cancelled', async () => {
    const { userId } = fixture();
    const own = ownEmailServicesOn(harness());
    const caller = await browserCaller(harness(), userId);

    await own.requests.request(caller, FIRST_ADDRESS);
    await own.requests.request(caller, SECOND_ADDRESS);

    expect(await storedAccount(harness(), userId)).toMatchObject({
      pendingEmail: SECOND_ADDRESS,
      addressGeneration: 2,
    });
    expect((await harness().claims()).map((row) => row.address)).toEqual([
      SECOND_ADDRESS,
    ]);

    await own.requests.cancel(caller);

    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: null,
      addressGeneration: 3,
    });
    expect(await harness().claims()).toEqual([]);
  });

  it('moves the account on its own code only, keeps the asking session and ends the others for the change', async () => {
    const { userId } = fixture();
    const own = ownEmailServicesOn(harness());
    const caller = await browserCaller(harness(), userId);
    await harness().seedSession(userId);
    await own.requests.request(caller, FIRST_ADDRESS);
    const code = codeMailedTo(await own.mail(), FIRST_ADDRESS);

    expect(
      await refusalOf(
        own.staffConfirmation.confirm({ email: FIRST_ADDRESS, code }),
      ),
    ).toEqual(CODE_INVALID);
    await own.confirmations.confirm(caller, code);

    expect(await storedAccount(harness(), userId)).toMatchObject({
      email: FIRST_ADDRESS,
      pendingEmail: null,
      isVerified: true,
      addressGeneration: 1,
    });
    expect(await harness().claims()).toEqual([]);
    expect(await harness().liveSessionIds(userId)).toEqual([caller.sessionId]);
    expect(await revocationsOf(harness())).toEqual([
      `sessions_revoked_others of ${userId} by nobody (email_changed)`,
    ]);
  });
}
