import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import {
  accountsOf,
  ADMIN_FORCED,
  DEFAULT_SLUG,
  MANAGER_SLUG,
  REVOKED_ALL,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

const CROWD_SLUG = 'crowd';
const RENAMED_SLUG = 'crowd-renamed';
/**
 * More accounts than a statement limited to 65,535 bound parameters can name
 * one by one, so an adapter that binds a parameter per holder is refused here.
 */
const CROWD = 66_000;
/**
 * These two cases only. On a machine at a load of 31 the rename took 16 s on
 * the slower database and 3 s on the faster, and the move 2.5 s on both. A
 * full run on a busier machine gets the room a database case does not need.
 */
const LARGE_MOVE_TIMEOUT_MS = 180_000;

/** A role held by more accounts than a statement can name one by one. */
export function roleLargeMoveCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const inUnitOfWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);
  const holdersOf = (slug: string): Promise<number> =>
    inUnitOfWork((unitOfWork) =>
      harness().changes.countHoldersInWork(unitOfWork, slug),
    );

  it(
    'renames a role 66,000 accounts hold, moving and signing out each one once',
    async () => {
      const crowd = await harness().seedRole({
        name: 'Crowd',
        slug: CROWD_SLUG,
        permissions: [],
      });
      const holders = await harness().seedAccounts(CROWD, CROWD_SLUG);
      const bystander = await harness().seedAccount({ role: DEFAULT_SLUG });

      const outcome = await servicesOn(harness()).edit.commit(
        crowd,
        { name: 'Crowd Renamed' },
        fixture().adminId,
      );

      const revocations = (await harness().events()).filter(
        (event) => event.action === REVOKED_ALL,
      );
      expect({
        seeded: holders.length,
        usersMoved: outcome.usersMoved,
        onNewSlug: await holdersOf(RENAMED_SLUG),
        onOldSlug: await holdersOf(CROWD_SLUG),
        firstLastAndBystander: await accountsOf(harness(), [
          holders[0],
          holders[CROWD - 1],
          bystander,
        ]),
        revocations: revocations.length,
        signedOut: new Set(revocations.map((event) => event.targetUserId)).size,
        actorsAndReasons: [
          ...new Set(
            revocations.map(
              (event) =>
                `${event.actorId ?? 'nobody'} (${event.reasonCode ?? 'no reason'})`,
            ),
          ),
        ],
      }).toEqual({
        seeded: 66000,
        usersMoved: 66000,
        onNewSlug: 66000,
        onOldSlug: 0,
        firstLastAndBystander: [
          { role: RENAMED_SLUG, sessionVersion: 1 },
          { role: RENAMED_SLUG, sessionVersion: 1 },
          { role: DEFAULT_SLUG, sessionVersion: 0 },
        ],
        revocations: 66000,
        signedOut: 66000,
        actorsAndReasons: [`${fixture().adminId} (${ADMIN_FORCED})`],
      });
    },
    LARGE_MOVE_TIMEOUT_MS,
  );

  it(
    'moves 66,000 accounts named one by one and reads the role each held before',
    async () => {
      const { changes, sweeps } = harness();
      const crowd = await harness().seedRole({
        name: 'Crowd',
        slug: CROWD_SLUG,
        permissions: [],
      });
      const manager = (await harness().role(MANAGER_SLUG))?.id ?? 'no manager';
      const holders = await harness().seedAccounts(CROWD, CROWD_SLUG);
      const leftBehind = await harness().seedAccount({ role: CROWD_SLUG });
      await harness().seedAssignment({
        userId: holders[CROWD - 1],
        assignedRoleId: crowd,
        previousRoleId: manager,
        sessionVersion: 1,
      });

      const { previous, moved } = await inUnitOfWork(async (unitOfWork) => ({
        previous: await sweeps.readPreviousRoles(unitOfWork, holders, crowd),
        moved: await changes.moveHolders(unitOfWork, {
          fromSlugs: holders.map(() => CROWD_SLUG),
          holderIds: holders,
          toSlug: DEFAULT_SLUG,
        }),
      }));

      expect({
        previous: [...previous],
        moved: moved.moved,
        movedIds: new Set(moved.holderIds).size,
        onDefault: await holdersOf(DEFAULT_SLUG),
        firstLastAndLeftBehind: await accountsOf(harness(), [
          holders[0],
          holders[CROWD - 1],
          leftBehind,
        ]),
      }).toEqual({
        previous: [[holders[CROWD - 1], manager]],
        moved: 66000,
        movedIds: 66000,
        onDefault: 66000,
        firstLastAndLeftBehind: [
          { role: DEFAULT_SLUG, sessionVersion: 1 },
          { role: DEFAULT_SLUG, sessionVersion: 1 },
          { role: CROWD_SLUG, sessionVersion: 0 },
        ],
      });
    },
    LARGE_MOVE_TIMEOUT_MS,
  );
}
