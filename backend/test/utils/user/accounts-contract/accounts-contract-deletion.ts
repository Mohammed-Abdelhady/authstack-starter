import { DeletionReceiptService } from '../../../../src/user/erasure/services/deletion-receipt.service';
import { TEST_NOW } from '../../frozen-clock';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ALL_USER,
  configurationForAccounts,
  refusalOf,
  REVOKED_ALL,
  revocationsOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const GRACE_DAYS = 30;
/** TEST_NOW and thirty days, written out so a changed rule cannot agree with itself. */
const ERASE_AFTER = new Date('2099-01-31T12:00:00.000Z');
const RECORDED = 'recorded';
const NOT_RECORDED = 'not_recorded';

/** A well-formed receipt key made now, distinct per case. */
function receiptKey(byte: string): string {
  return `r1.${TEST_NOW.getTime()}.${byte.repeat(32)}`;
}

/** The public route's answer for a key, from what the database committed. */
function receiptOf(harness: AccountsHarnessSource, key: string) {
  return new DeletionReceiptService(
    harness().deletion,
    harness().clock,
  ).stateOf(key);
}

function erasureOn(harness: AccountsHarnessSource) {
  return servicesOn(
    harness(),
    rerunAtOnce,
    undefined,
    configurationForAccounts({}, { eraseGraceDays: GRACE_DAYS }),
  );
}

/** A person's own deletion with a receipt key, while erasure is on. */
export function accountDeletionReceiptCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('records the deactivation, its erasure date, its receipt and the end of its sessions together', async () => {
    const { userId } = fixture();
    await harness().seedSession(userId);
    const key = receiptKey('a1');

    const answer = await erasureOn(harness).profile.deactivateAccount(
      userId,
      key,
    );

    expect(answer.data.eraseAfter).toBe(ERASE_AFTER.toISOString());
    expect(await storedAccount(harness(), userId)).toMatchObject({
      isDeleted: true,
      deletedAt: TEST_NOW,
      sessionVersion: 1,
    });
    expect(await harness().liveSessionIds(userId)).toEqual([]);
    expect(await harness().deletion.findEraseAfter(userId)).toEqual(
      ERASE_AFTER,
    );
    expect(await receiptOf(harness, key)).toBe(RECORDED);
  });

  it('answers a repeat of the same key the same way and deletes once', async () => {
    const { userId } = fixture();
    const key = receiptKey('b2');
    const services = erasureOn(harness);
    const first = await services.profile.deactivateAccount(userId, key);
    harness().clock.advance(60_000);

    const again = await services.profile.deactivateAccount(userId, key);

    expect(again.data.eraseAfter).toBe(first.data.eraseAfter);
    expect((await storedAccount(harness(), userId)).deletedAt).toEqual(
      TEST_NOW,
    );
    expect(await revocationsOf(harness())).toEqual([
      `${REVOKED_ALL} of ${userId} by nobody (${ALL_USER})`,
    ]);
  });

  it("refuses a key another account's deletion used and leaves that account whole", async () => {
    const { userId, supportId } = fixture();
    const kept = await harness().seedSession(supportId);
    const key = receiptKey('c3');
    const services = erasureOn(harness);
    await services.profile.deactivateAccount(userId, key);

    expect(
      await refusalOf(services.profile.deactivateAccount(supportId, key)),
    ).toEqual({ code: 'CONFLICT', status: 409 });
    expect(await storedAccount(harness(), supportId)).toMatchObject({
      isDeleted: false,
      deletedAt: null,
      sessionVersion: 0,
    });
    expect(await harness().liveSessionIds(supportId)).toEqual([kept]);
  });

  it('keeps no receipt when the sign-out cannot be recorded and the deletion rolls back', async () => {
    const { userId } = fixture();
    const key = receiptKey('d4');
    const restore = await harness().refuseSecurityEvents();
    let rejected = false;
    try {
      await erasureOn(harness)
        .profile.deactivateAccount(userId, key)
        .catch(() => {
          rejected = true;
        });
    } finally {
      restore();
    }

    expect(rejected).toBe(true);
    expect((await storedAccount(harness(), userId)).isDeleted).toBe(false);
    expect(await harness().deletion.findEraseAfter(userId)).toBeNull();
    expect(await receiptOf(harness, key)).toBe(NOT_RECORDED);
  });
}
