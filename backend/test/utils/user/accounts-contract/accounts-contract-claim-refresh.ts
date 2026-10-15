import { CLAIM_OWNER, holdAddress } from '../../address-claim';
import {
  MAIL_COUNTER_PURPOSE,
  MAILED_CODE_WINDOW_MS,
} from '../../../../src/auth/constants/registration';
import { MAIL_RECORD } from '../../../../src/auth/pending-codes/mail-counter.store';
import { RaceGate, holdBefore } from '../../race-gate';
import {
  ADMIN_SLUG,
  AccountsHarnessSource,
  AccountsFixture,
  refusalOf,
  servicesOn,
  storedAccount,
  lastMailedCode,
} from './accounts-contract-support';

const FIRST_ADDRESS = 'first-pending@example.test';

export function accountClaimRefreshCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  // A resend must extend the same persisted hold as its code, without stealing a takeover.
  it.each([false, true])(
    'L13 refreshes or refuses a resend with takeover=%s',
    async (takeover) => {
      const h = harness();
      const { userId, adminId } = fixture();
      const services = servicesOn(h);
      await services.adminUsers.updateUser(
        userId,
        { email: FIRST_ADDRESS },
        adminId,
        ADMIN_SLUG,
      );
      const firstLapse = new Date('2099-01-01T12:15:00.000Z');
      const original = await h.emailChangeCode(FIRST_ADDRESS);
      expect(original?.expiresAt).toEqual(firstLapse);
      if (takeover) {
        h.clock.set(firstLapse);
        await holdAddress(
          h.ledger,
          h.runner(() => Promise.resolve()),
          h.clock,
          FIRST_ADDRESS,
        );
        const before = services.mail.length;
        expect(
          await refusalOf(
            services.adminUsers.resendEmailChange(userId, adminId, ADMIN_SLUG),
          ),
        ).toEqual({ code: 'EMAIL_ALREADY_EXISTS', status: 409 });
        expect(services.mail.length).toBe(before);
        expect(await h.emailChangeCode(FIRST_ADDRESS)).toEqual(original);
        expect((await h.claims()).map((row) => row.owner)).toEqual([
          CLAIM_OWNER,
        ]);
        expect(
          await h.mailCounters.recordWithinCap(
            {
              email: FIRST_ADDRESS,
              purpose: MAIL_COUNTER_PURPOSE.EMAIL_CHANGE,
            },
            { now: h.clock.now(), windowMs: MAILED_CODE_WINDOW_MS, limit: 1 },
          ),
        ).toBe(MAIL_RECORD.RECORDED);
        return;
      }
      h.clock.advance(1);
      await services.adminUsers.resendEmailChange(userId, adminId, ADMIN_SLUG);
      expect((await h.claims()).map((row) => row.lapsesAt)).toEqual([
        new Date('2099-01-01T12:15:00.001Z'),
      ]);
      expect((await h.emailChangeCode(FIRST_ADDRESS))?.expiresAt).toEqual(
        new Date('2099-01-01T12:15:00.001Z'),
      );
      h.clock.set(firstLapse);
      expect(
        await h
          .runner(() => Promise.resolve())
          .run((uow) =>
            h.ledger.isFree(uow, {
              address: FIRST_ADDRESS,
              now: h.clock.now(),
            }),
          ),
      ).toBe(false);
      await services.emailChange.confirm({
        email: FIRST_ADDRESS,
        code: lastMailedCode(services),
      });
      expect((await storedAccount(h, userId)).email).toBe(FIRST_ADDRESS);
      expect(await h.claims()).toEqual([]);
    },
  );
  it('does not revive a stale pending address when a delayed resend resumes', async () => {
    const h = harness();
    const { userId, adminId } = fixture();
    const services = servicesOn(h);
    await services.adminUsers.updateUser(
      userId,
      { email: FIRST_ADDRESS },
      adminId,
      ADMIN_SLUG,
    );
    const held = new RaceGate();
    const restore = holdBefore(h.admin, 'takeEmailChangeTarget', (call) =>
      call === 0 ? held : undefined,
    );
    const resend = refusalOf(
      services.adminUsers.resendEmailChange(userId, adminId, ADMIN_SLUG),
    );
    try {
      await Promise.race([
        held.reached(),
        resend.then(() => {
          throw new Error('resend ended before the target-read gate');
        }),
      ]);
      await services.adminUsers.updateUser(
        userId,
        { email: 'newer-choice@example.test' },
        adminId,
        ADMIN_SLUG,
      );
      const mailed = services.mail.length;
      held.release();
      expect(await resend).toEqual({
        code: 'EMAIL_ALREADY_EXISTS',
        status: 409,
      });
      expect(services.mail.length).toBe(mailed);
      expect((await h.claims()).map((row) => row.address)).toEqual([
        'newer-choice@example.test',
      ]);
    } finally {
      held.release();
      restore();
      await Promise.allSettled([resend]);
    }
  });
}
