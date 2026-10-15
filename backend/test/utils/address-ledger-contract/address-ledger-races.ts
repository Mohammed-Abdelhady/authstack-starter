import { RaceGate, holdBefore } from '../race-gate';
import { LedgerHarnessSource } from './address-ledger-harness';
import {
  ADDRESS,
  claim,
  claimInput,
  FIRST_OWNER,
  LAPSE_MS,
  SECOND_OWNER,
} from './address-ledger-support';

export function ledgerRaceCases(current: LedgerHarnessSource): void {
  it.each([false, true])(
    'L2/L4 serialises two claimers with lapsed=%s',
    async (lapsed) => {
      const h = current();
      if (lapsed) {
        await h.seedClaim(claimInput(h, 'old-owner'));
        h.clock.advance(LAPSE_MS);
      }
      const start = new RaceGate();
      const committed = new RaceGate();
      const restore = holdBefore(h.ledger, 'claim', (call) =>
        call < 2 ? start : undefined,
      );
      const runner = h.runner(() => committed.hold());
      const compete = async (owner: string) => {
        const result = await claim(h, claimInput(h, owner), runner);
        if (result === 'claimed') committed.release();
        return { owner, result };
      };
      const first = compete(FIRST_OWNER);
      const second = compete(SECOND_OWNER);
      try {
        await Promise.race([
          start.reached(2),
          Promise.all([first, second]).then(() => {
            throw new Error('claimers completed before the start gate');
          }),
        ]);
        start.release();
        const results = await Promise.all([first, second]);
        expect(results.map(({ result }) => result).sort()).toEqual([
          'claimed',
          'taken',
        ]);
        const winner = results.find(({ result }) => result === 'claimed');
        const rows = await h.claims();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.address).toBe(ADDRESS);
        expect(rows[0]?.owner).toBe(winner?.owner);
      } finally {
        start.release();
        committed.release();
        restore();
        await Promise.allSettled([first, second]);
      }
    },
  );

  it('L15 checks the committed account after contending with a reservation', async () => {
    const h = current();
    const creatorHeld = new RaceGate();
    const creatorCommitted = new RaceGate();
    const contending = h.contention(creatorCommitted.hold());
    const creator = h.runner().run(async (uow) => {
      const result = await h.ledger.reserveForAccount(uow, {
        address: ADDRESS,
        now: h.clock.now(),
      });
      if (result.status !== 'reserved') throw new Error('reservation refused');
      await h.insertAccount(uow, ADDRESS);
      await h.ledger.finishAccountReservation(uow, result.reservation);
      await creatorHeld.hold();
    });
    let claimer: Promise<string> | undefined;
    let observer: Promise<void> | undefined;
    try {
      await Promise.race([
        creatorHeld.reached(),
        creator.then(() => {
          throw new Error('creator completed before the reservation gate');
        }),
      ]);
      claimer = claim(h, claimInput(h, SECOND_OWNER), contending.runner);
      observer = contending.blocked();
      await Promise.race([
        observer,
        claimer.then(() => {
          throw new Error('claimer completed before contention was observed');
        }),
      ]);
      creatorHeld.release();
      await creator;
      creatorCommitted.release();
      expect(await claimer).toBe('taken');
      expect(await h.claims()).toEqual([]);
      expect(await h.accounts()).toEqual([
        {
          email: ADDRESS,
          deleted: false,
        },
      ]);
    } finally {
      contending.stop();
      creatorHeld.release();
      creatorCommitted.release();
      await Promise.allSettled([creator, claimer, observer]);
    }
  });
}
