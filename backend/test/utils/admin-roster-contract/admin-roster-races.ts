import { RaceGate } from '../race-gate';
import { RosterHarnessSource } from './admin-roster-harness';

export function rosterRaceCases(current: RosterHarnessSource): void {
  // Concurrent removals must not both observe the same last remaining administrator.
  it('holds the roster lock until the first unit of work commits', async () => {
    const h = current();
    await h.runner().run((uow) => h.roster.lock(uow));
    const held = new RaceGate();
    const committed = new RaceGate();
    const contending = h.contention(committed.hold());
    const events: string[] = [];
    const first = h.runner().run(async (uow) => {
      await h.roster.lock(uow);
      events.push('first-entered');
      await held.hold();
      events.push('first-exiting');
    });
    let second: Promise<void> | undefined;
    let observer: Promise<void> | undefined;
    try {
      await Promise.race([
        held.reached(),
        first.then(() => {
          throw new Error('first unit ended before the gate');
        }),
      ]);
      second = contending.runner.run(async (uow) => {
        await h.roster.lock(uow);
        events.push('second-entered');
      });
      observer = contending.blocked();
      await Promise.race([
        observer,
        second.then(() => {
          throw new Error('second unit passed a held lock');
        }),
      ]);
      expect(events).toEqual(['first-entered']);
      held.release();
      await first;
      committed.release();
      await second;
      expect(events).toEqual([
        'first-entered',
        'first-exiting',
        'second-entered',
      ]);
    } finally {
      contending.stop();
      held.release();
      committed.release();
      await Promise.allSettled([first, second, observer]);
    }
  });
}
