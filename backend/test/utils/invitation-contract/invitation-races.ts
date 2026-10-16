import { RaceGate } from '../race-gate';
import type { InvitationHarnessSource } from './invitation-harness';
import { insert } from './invitation-support';

export function invitationRaceCases(current: InvitationHarnessSource): void {
  // Two transactions must not both observe a usable token and create two accounts.
  it.each(['id', 'hash'] as const)(
    'holds take-by-%s until commit and gives the next taker the accepted state',
    async (lookup) => {
      const h = current();
      const invitation = await insert(h);
      const held = new RaceGate();
      const committed = new RaceGate();
      const contending = h.contention(committed.hold());
      const take = (work: Parameters<typeof h.store.takeById>[0]) =>
        lookup === 'id'
          ? h.store.takeById(work, invitation.id)
          : h.store.takeByTokenHash(work, invitation.tokenHash);
      const first = h.runner().run(async (work) => {
        expect((await take(work))?.acceptedAt).toBeUndefined();
        await held.hold();
        await h.store.markAccepted(work, invitation.id, h.clock.now());
      });
      let second: Promise<Date | undefined> | undefined;
      let observer: Promise<void> | undefined;
      try {
        await Promise.race([
          held.reached(),
          first.then(() => {
            throw new Error('First taker passed the gate');
          }),
        ]);
        second = contending.runner.run(
          async (work) => (await take(work))?.acceptedAt,
        );
        observer = contending.blocked();
        await Promise.race([
          observer,
          second.then(() => {
            throw new Error(
              'Second taker read while the first held the invitation',
            );
          }),
        ]);
        held.release();
        await first;
        committed.release();
        expect(await second).toEqual(h.clock.now());
      } finally {
        contending.stop();
        held.release();
        committed.release();
        await Promise.allSettled([first, second, observer]);
      }
    },
  );
}
