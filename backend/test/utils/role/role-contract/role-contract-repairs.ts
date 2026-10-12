import { finishBootstrap } from '../../../../src/role/services/bootstrap/role-bootstrap.harness-spec';
import { holdBefore, RaceGate } from '../../race-gate';
import { holdReruns } from '../../session/issuance-contract/issuance-contract-support';
import {
  accountsOf,
  ADMIN_FORCED,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  LEAD_SLUG,
  revocationsOf,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

const REFUSED_AT_THE_ROLE = 'refused at the role';
const MOVED_UNDER_THE_FIRST =
  'reached the holders while the first held the role';

/**
 * A rename that committed and never moved its holders. The repair owes each
 * holder one move and one sign-out, however many instances run it.
 */
export function roleRepairCases(
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

  /** Call 0 is the first repair's own holder move. Any later one is the second's. */
  function holdHolderMoves(first: RaceGate, later: RaceGate): void {
    restores.push(
      holdBefore(harness().changes, 'moveHolders', (call) =>
        call === 0 ? first : later,
      ),
    );
  }

  async function interruptedRename() {
    const holders = [
      await harness().seedAccount({ role: EDITOR_SLUG }),
      await harness().seedAccount({ role: EDITOR_SLUG }),
    ];
    const bystander = await harness().seedAccount({ role: DEFAULT_SLUG });
    await harness().interruptRename(fixture().editorRoleId, {
      name: 'Content Lead',
      slug: LEAD_SLUG,
      previousSlug: EDITOR_SLUG,
      actorId: fixture().adminId,
    });
    return { holders, bystander };
  }

  const repaired = (holders: string[], adminId: string) => ({
    owed: [],
    accounts: [
      { role: LEAD_SLUG, sessionVersion: 1 },
      { role: LEAD_SLUG, sessionVersion: 1 },
      { role: DEFAULT_SLUG, sessionVersion: 0 },
    ],
    revocations: holders
      .map((holder) => `${holder} by ${adminId} (${ADMIN_FORCED})`)
      .sort(),
  });

  async function storedRepair(holders: string[], bystander: string) {
    return {
      owed: (await harness().role(LEAD_SLUG))?.owedRepairs,
      accounts: await accountsOf(harness(), [...holders, bystander]),
      revocations: await revocationsOf(harness()),
    };
  }

  it('repairs an interrupted rename at start and signs each holder out once', async () => {
    const { holders, bystander } = await interruptedRename();
    const before = (await harness().role(LEAD_SLUG))?.owedRepairs;

    await finishBootstrap([servicesOn(harness()).bootstrap()]);
    const afterFirstStart = await storedRepair(holders, bystander);
    await finishBootstrap([servicesOn(harness()).bootstrap()]);

    expect({
      before,
      afterFirstStart,
      afterSecondStart: await storedRepair(holders, bystander),
    }).toEqual({
      before: [`${EDITOR_SLUG} for ${fixture().editorRoleId}`],
      afterFirstStart: repaired(holders, fixture().adminId),
      afterSecondStart: repaired(holders, fixture().adminId),
    });
  });

  it('repairs an interrupted rename on the next edit of the role', async () => {
    const { holders, bystander } = await interruptedRename();

    const answer = await servicesOn(harness()).roles.update(
      LEAD_SLUG,
      { description: 'Leads content' },
      fixture().adminId,
    );

    expect({
      usersMoved: answer.usersMoved,
      stored: await storedRepair(holders, bystander),
    }).toEqual({
      usersMoved: 2,
      stored: repaired(holders, fixture().adminId),
    });
  });

  it('lets one of two instances repairing at once move the holders', async () => {
    const { holders, bystander } = await interruptedRename();
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const firstOwnsRole = gate();
    const secondReachedHolders = gate();
    holdHolderMoves(firstOwnsRole, secondReachedHolders);

    const first = finishBootstrap([servicesOn(harness()).bootstrap()]);
    await firstOwnsRole.reached(1);
    const second = servicesOn(harness(), reruns.pause).bootstrap();
    second.onApplicationBootstrap();
    const secondWas = await Promise.race([
      reruns.refused.reached(1).then(() => REFUSED_AT_THE_ROLE),
      secondReachedHolders.reached(1).then(() => MOVED_UNDER_THE_FIRST),
    ]);
    const whileBothHeld = await accountsOf(harness(), holders);

    firstOwnsRole.release();
    secondReachedHolders.release();
    await first;
    reruns.refused.release();
    await second.onApplicationShutdown();

    expect({
      secondWas,
      whileBothHeld,
      pauses: reruns.calls,
      stored: await storedRepair(holders, bystander),
    }).toEqual({
      secondWas: REFUSED_AT_THE_ROLE,
      whileBothHeld: [
        { role: EDITOR_SLUG, sessionVersion: 0 },
        { role: EDITOR_SLUG, sessionVersion: 0 },
      ],
      pauses: [1],
      stored: repaired(holders, fixture().adminId),
    });
  });
}
