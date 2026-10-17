import type { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import { RaceGate } from '../race-gate';
import { ADDRESS_CLAIM_KIND } from '../../../src/common/persistence/address-ledger';
import type { LedgerHarnessSource } from './address-ledger-harness';
import {
  ADDRESS,
  AddressTaken,
  claimInput,
  FIRST_OWNER,
} from './address-ledger-support';

export function ownEmailReservationCases(current: LedgerHarnessSource): void {
  it.each([false, true])(
    'serializes code-proven creation and own-email confirmation, registration first=%s',
    async (registrationFirst) => {
      const h = current();
      await h.seedClaim({
        ...claimInput(h),
        kind: ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE,
      });
      const held = new RaceGate();
      const committed = new RaceGate();
      const contending = h.contention(committed.hold());
      const actor = async (work: UnitOfWork, registration: boolean) => {
        if (registration) {
          const result = await h.ledger.reserveForAccount(work, {
            address: ADDRESS,
            now: h.clock.now(),
          });
          if (result.status === 'taken') throw new AddressTaken();
          await h.insertAccount(work, ADDRESS);
          await h.ledger.finishAccountReservation(work, result.reservation);
          return 'registered';
        }
        const owns = await h.ledger.holdsLiveClaim(work, {
          address: ADDRESS,
          owner: FIRST_OWNER,
          now: h.clock.now(),
        });
        if (!owns) throw new AddressTaken();
        await h.insertAccount(work, ADDRESS);
        await h.ledger.release(work, { address: ADDRESS, owner: FIRST_OWNER });
        return 'confirmed';
      };
      const first = h.runner().run(async (work) => {
        const result = await actor(work, registrationFirst);
        await held.hold();
        return result;
      });
      let second: Promise<string> | undefined;
      let observer: Promise<void> | undefined;
      try {
        await Promise.race([
          held.reached(),
          first.then(() => {
            throw new Error('first transaction ended before the gate');
          }),
        ]);
        second = contending.runner
          .run((work) => actor(work, !registrationFirst))
          .catch((error: unknown) => {
            if (error instanceof AddressTaken) return 'taken';
            throw error;
          });
        observer = contending.blocked();
        await Promise.race([
          observer,
          second.then(() => {
            throw new Error('second transaction bypassed the held claim');
          }),
        ]);
        held.release();
        expect(await first).toBe(
          registrationFirst ? 'registered' : 'confirmed',
        );
        committed.release();
        expect(await second).toBe('taken');
        expect(await h.accounts()).toEqual([
          { email: ADDRESS, deleted: false },
        ]);
        expect(await h.claims()).toEqual([]);
      } finally {
        contending.stop();
        held.release();
        committed.release();
        await Promise.allSettled([first, second, observer]);
      }
    },
  );

  it.each([
    ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE,
    ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
  ])(
    'code-proven registration takes only a self-started pending claim: %s',
    async (kind) => {
      const h = current();
      await h.seedClaim({ ...claimInput(h), kind });
      const available = await h.runner().run((work) =>
        h.ledger.isFree(work, {
          address: ADDRESS,
          now: h.clock.now(),
          forRegistration: true,
        }),
      );
      expect(available).toBe(kind === ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE);
      const create = h.runner().run(async (work) => {
        const result = await h.ledger.reserveForAccount(work, {
          address: ADDRESS,
          now: h.clock.now(),
        });
        if (result.status === 'taken') throw new AddressTaken();
        await h.insertAccount(work, ADDRESS);
        await h.ledger.finishAccountReservation(work, result.reservation);
      });
      if (kind === ADDRESS_CLAIM_KIND.OWN_EMAIL_CHANGE) {
        await create;
        expect(await h.accounts()).toEqual([
          { email: ADDRESS, deleted: false },
        ]);
        expect(await h.claims()).toEqual([]);
        expect(
          await h.runner().run((work) =>
            h.ledger.holdsLiveClaim(work, {
              address: ADDRESS,
              owner: FIRST_OWNER,
              now: h.clock.now(),
            }),
          ),
        ).toBe(false);
      } else {
        await expect(create).rejects.toBeInstanceOf(AddressTaken);
        expect(await h.accounts()).toEqual([]);
        expect((await h.claims()).map((row) => row.owner)).toEqual([
          FIRST_OWNER,
        ]);
      }
    },
  );
}
