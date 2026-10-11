import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  holdReruns,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  accountsOf,
  ADMIN_FORCED,
  answerOf,
  CHIEF_SLUG,
  EDITOR_SLUG,
  LEAD_SLUG,
  revocationsOf,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

const DONE = 'done';
const REFUSED_AT_THE_ROLE = 'refused at the role';
const REFUSED_AT_THE_HOLDERS = 'refused at the holders';
const MOVED_UNDER_THE_FIRST =
  'reached the holders while the first held the role';

async function outcomeOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return DONE;
  } catch (error) {
    return answerOf(error).code;
  }
}

/**
 * Two changes that want the same role. The first is held after it has written
 * the role and before it moves the holders, so it owns the role. The second
 * must be refused at the role and wait to run again: each case awaits that
 * refusal, so both sides are proven where they stand before either moves.
 */
export function roleRaceCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  let gates: RaceGate[] = [];
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  function gate(): RaceGate {
    const created = new RaceGate();
    gates.push(created);
    return created;
  }

  /** Call 0 is the first change's own holder move. Any later one is the second's. */
  function holdHolderMoves(first: RaceGate, later: RaceGate): void {
    restores.push(
      holdBefore(harness().changes, 'moveHolders', (call) =>
        call === 0 ? first : later,
      ),
    );
  }

  async function raceTwoRenames(releaseFirst: boolean) {
    const holder = await harness().seedAccount({ role: EDITOR_SLUG });
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const firstOwnsRole = gate();
    const secondReachedHolders = gate();
    holdHolderMoves(firstOwnsRole, secondReachedHolders);
    const rename = (name: string, pause = rerunAtOnce) =>
      outcomeOf(
        servicesOn(harness(), pause).roles.update(
          fixture().editorRoleId,
          { name },
          fixture().adminId,
        ),
      );

    const first = rename('Content Lead');
    await firstOwnsRole.reached(1);
    const second = rename('Content Chief', reruns.pause);
    const secondWas = await Promise.race([
      reruns.refused.reached(1).then(() => REFUSED_AT_THE_ROLE),
      secondReachedHolders.reached(1).then(() => MOVED_UNDER_THE_FIRST),
    ]);
    const whileBothHeld = await harness().account(holder);

    if (releaseFirst) {
      firstOwnsRole.release();
      secondReachedHolders.release();
      const firstOutcome = await first;
      reruns.refused.release();
      return {
        holder,
        secondWas,
        whileBothHeld,
        first: firstOutcome,
        second: await second,
        pauses: reruns.calls,
      };
    }
    reruns.refused.release();
    const secondOutcome = await second;
    const afterSecondGaveUp = await harness().account(holder);
    firstOwnsRole.release();
    secondReachedHolders.release();
    return {
      holder,
      secondWas,
      whileBothHeld,
      afterSecondGaveUp,
      first: await first,
      second: secondOutcome,
      pauses: reruns.calls,
    };
  }

  it('runs two renames of one role one after the other, the later on top', async () => {
    const race = await raceTwoRenames(true);

    expect({
      race: { ...race, holder: undefined },
      roles: {
        editor: await harness().role(EDITOR_SLUG),
        lead: await harness().role(LEAD_SLUG),
        chief: (await harness().role(CHIEF_SLUG))?.name,
        owed: (await harness().role(CHIEF_SLUG))?.owedRepairs,
      },
      holder: await harness().account(race.holder),
      revocations: await revocationsOf(harness()),
    }).toEqual({
      race: {
        holder: undefined,
        secondWas: REFUSED_AT_THE_ROLE,
        whileBothHeld: { role: EDITOR_SLUG, sessionVersion: 0 },
        first: DONE,
        second: DONE,
        pauses: [1],
      },
      roles: {
        editor: null,
        lead: null,
        chief: 'Content Chief',
        owed: [],
      },
      holder: { role: CHIEF_SLUG, sessionVersion: 2 },
      revocations: [
        `${race.holder} by ${fixture().adminId} (${ADMIN_FORCED})`,
        `${race.holder} by ${fixture().adminId} (${ADMIN_FORCED})`,
      ],
    });
  });

  it('gives up a rename as unavailable after three refusals and changes nothing', async () => {
    const race = await raceTwoRenames(false);

    expect({
      race: { ...race, holder: undefined },
      roles: {
        lead: (await harness().role(LEAD_SLUG))?.name,
        chief: await harness().role(CHIEF_SLUG),
      },
      holder: await harness().account(race.holder),
    }).toEqual({
      race: {
        holder: undefined,
        secondWas: REFUSED_AT_THE_ROLE,
        whileBothHeld: { role: EDITOR_SLUG, sessionVersion: 0 },
        afterSecondGaveUp: { role: EDITOR_SLUG, sessionVersion: 0 },
        first: DONE,
        second: ErrorCode.AUTHORITY_UNAVAILABLE,
        pauses: [1, 2],
      },
      roles: { lead: 'Content Lead', chief: null },
      holder: { role: LEAD_SLUG, sessionVersion: 1 },
    });
  });

  it('commits the owed repair with the rename, before the repair runs', async () => {
    const holder = await harness().seedAccount({ role: EDITOR_SLUG });
    const committed = gate();
    restores.push(
      holdBefore(harness().sweeps, 'clearPendingSweep', () => committed),
    );

    const rename = servicesOn(harness()).roles.update(
      EDITOR_SLUG,
      { name: 'Content Lead' },
      fixture().adminId,
    );
    await committed.reached(1);
    const beforeTheRepairCleared = {
      owed: (await harness().role(LEAD_SLUG))?.owedRepairs,
      holder: await harness().account(holder),
    };
    committed.release();
    await rename;

    expect({
      beforeTheRepairCleared,
      owedAfter: (await harness().role(LEAD_SLUG))?.owedRepairs,
    }).toEqual({
      beforeTheRepairCleared: {
        owed: [`${EDITOR_SLUG} for ${fixture().editorRoleId}`],
        holder: { role: LEAD_SLUG, sessionVersion: 1 },
      },
      owedAfter: [],
    });
  });

  it('refuses a second move of holders another unit of work is moving', async () => {
    const holders = [
      await harness().seedAccount({ role: EDITOR_SLUG }),
      await harness().seedAccount({ role: EDITOR_SLUG }),
    ];
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const firstMoved = gate();
    const move = { fromSlugs: [EDITOR_SLUG], toSlug: LEAD_SLUG };

    const first = harness()
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        const moved = await harness().changes.moveHolders(unitOfWork, move);
        await firstMoved.hold();
        return moved.moved;
      });
    await firstMoved.reached(1);
    const secondMoved = gate();
    const second = harness()
      .runner(reruns.pause)
      .run(async (unitOfWork) => {
        const moved = await harness().changes.moveHolders(unitOfWork, move);
        await secondMoved.hold();
        return moved.moved;
      });
    const secondWas = await Promise.race([
      reruns.refused.reached(1).then(() => REFUSED_AT_THE_HOLDERS),
      secondMoved.reached(1).then(() => MOVED_UNDER_THE_FIRST),
    ]);
    const whileBothHeld = await accountsOf(harness(), holders);

    firstMoved.release();
    secondMoved.release();
    const firstCount = await first;
    reruns.refused.release();

    expect({
      first: firstCount,
      second: await second,
      secondWas,
      whileBothHeld,
      pauses: reruns.calls,
      accounts: await accountsOf(harness(), holders),
    }).toEqual({
      first: 2,
      second: 0,
      secondWas: REFUSED_AT_THE_HOLDERS,
      whileBothHeld: [
        { role: EDITOR_SLUG, sessionVersion: 0 },
        { role: EDITOR_SLUG, sessionVersion: 0 },
      ],
      pauses: [1],
      accounts: [
        { role: LEAD_SLUG, sessionVersion: 1 },
        { role: LEAD_SLUG, sessionVersion: 1 },
      ],
    });
  });
}
