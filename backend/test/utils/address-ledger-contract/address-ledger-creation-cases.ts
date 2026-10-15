import { ACCOUNT_RESERVATION_RESULT } from '../../../src/common/persistence/address-ledger';
import { AccountCreationRefusedError } from '../../../src/auth/services/registration/account-creation-refused.error';
import { UniqueConflictError } from '../../../src/common/persistence/persistence-errors';
import { RaceGate, holdBefore } from '../race-gate';
import { LedgerHarnessSource } from './address-ledger-harness';
import {
  ADDRESS,
  AddressTaken,
  claim,
  claimInput,
  SECOND_OWNER,
} from './address-ledger-support';

export function ledgerCreationCases(current: LedgerHarnessSource): void {
  // A failed body must not leave an address held or a partly inserted account.
  it.each(['policy', 'insert'])(
    'L8 the claim joins the caller UOW on %s failure',
    async (failure) => {
      const h = current();
      await expect(
        h.runner().run(async (uow) => {
          const reservation = await h.ledger.reserveForAccount(uow, {
            address: ADDRESS,
            now: h.clock.now(),
          });
          if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN)
            throw new AddressTaken();
          if (failure === 'policy') throw new AccountCreationRefusedError();
          await h.insertAccount(uow, ADDRESS);
          await h.insertAccount(uow, ADDRESS);
        }),
      ).rejects.toThrow(
        failure === 'policy'
          ? AccountCreationRefusedError
          : UniqueConflictError,
      );
      expect(await h.claims()).toEqual([]);
      expect(await h.accounts()).toEqual([]);
    },
  );

  // The absent address must have exactly one persisted winner across both workflows.
  it('L11 serialises account creation against an email-change claim', async () => {
    const h = current();
    const start = new RaceGate();
    const committed = new RaceGate();
    const restore = holdBefore(h.ledger, 'claim', (call) =>
      call < 2 ? start : undefined,
    );
    const runner = h.runner(() => committed.hold());
    const creator = runner
      .run(async (uow) => {
        const reservation = await h.ledger.reserveForAccount(uow, {
          address: ADDRESS,
          now: h.clock.now(),
        });
        if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN)
          throw new AddressTaken();
        await h.insertAccount(uow, ADDRESS);
        await h.ledger.finishAccountReservation(uow, reservation.reservation);
        return 'created';
      })
      .then(
        (result) => {
          committed.release();
          return result;
        },
        (error: unknown) => {
          if (error instanceof AddressTaken) return 'taken';
          throw error;
        },
      );
    const changer = claim(h, claimInput(h, SECOND_OWNER), runner).then(
      (result) => {
        if (result === 'claimed') committed.release();
        return result;
      },
    );
    try {
      await Promise.race([
        start.reached(2),
        Promise.all([creator, changer]).then(() => {
          throw new Error('both workflows ended before the gate');
        }),
      ]);
      start.release();
      const results = await Promise.all([creator, changer]);
      if (results[0] === 'created') {
        expect(results).toEqual(['created', 'taken']);
        expect(await h.accounts()).toEqual([
          { email: ADDRESS, deleted: false },
        ]);
        expect(await h.claims()).toEqual([]);
      } else {
        expect(results).toEqual(['taken', 'claimed']);
        expect(await h.accounts()).toEqual([]);
        expect((await h.claims()).map((row) => row.owner)).toEqual([
          SECOND_OWNER,
        ]);
      }
    } finally {
      start.release();
      committed.release();
      restore();
      await Promise.allSettled([creator, changer]);
    }
  });
}
