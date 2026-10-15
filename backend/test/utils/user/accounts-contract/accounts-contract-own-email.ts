import { ADDRESS_CLAIM_KIND } from '../../../../src/common/persistence/address-ledger';
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
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
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
