import { Logger } from '@nestjs/common';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { sweepRoleHolders } from '../../../../src/role/sweeps/role-holder-sweep';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import {
  accountsOf,
  ADMIN_FORCED,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  MANAGER_SLUG,
  READ_POSTS,
  revocationsOf,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

const OLDEST = new Date('2098-01-01T00:00:00.000Z');
const MIDDLE = new Date('2098-01-02T00:00:00.000Z');
const NEWEST = new Date('2098-01-03T00:00:00.000Z');
const GONE_SLUG = 'gone';

/** The list of repairs owed, and where the holders of a deleted role go. */
export function roleSweepStoreCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const inUnitOfWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);
  const owedBy = async (slug: string) =>
    (await harness().role(slug))?.owedRepairs;

  it('records an owed repair once, up to the limit, and clears exactly that one', async () => {
    const { sweeps } = harness();
    const editor = fixture().editorRoleId;
    const first = {
      roleId: editor,
      previousSlug: 'old-one',
      actorId: fixture().adminId,
      sweepId: 'first',
    };
    const second = { ...first, previousSlug: 'old-two', sweepId: 'second' };
    const third = { ...first, previousSlug: 'old-three', sweepId: 'third' };

    await sweeps.recordPendingSweepIfRoom(editor, first, 2);
    await sweeps.recordPendingSweepIfRoom(editor, first, 2);
    await sweeps.recordPendingSweepIfRoom(editor, second, 2);
    await sweeps.recordPendingSweepIfRoom(editor, third, 2);
    const recorded = await owedBy(EDITOR_SLUG);
    const actor = await inUnitOfWork((unitOfWork) =>
      sweeps.findPendingSweepActor(unitOfWork, editor, 'old-two'),
    );
    const nobody = await inUnitOfWork((unitOfWork) =>
      sweeps.findPendingSweepActor(unitOfWork, editor, 'never-owed'),
    );
    await sweeps.clearPendingSweep(editor, { ...first, sweepId: 'other' });
    const afterWrongSweep = await owedBy(EDITOR_SLUG);
    await sweeps.clearPendingSweep(editor, first);

    expect({
      recorded,
      actor,
      nobody,
      afterWrongSweep,
      afterClearing: await owedBy(EDITOR_SLUG),
      owner: await sweeps.findSweepOwnerBySlug(EDITOR_SLUG),
      noOwner: await sweeps.findSweepOwnerBySlug('ghost'),
    }).toEqual({
      recorded: [`old-one for ${editor}`, `old-two for ${editor}`],
      actor: fixture().adminId,
      nobody: null,
      afterWrongSweep: [`old-one for ${editor}`, `old-two for ${editor}`],
      afterClearing: [`old-two for ${editor}`],
      owner: { id: editor, pendingHolderSweeps: [second] },
      noOwner: null,
    });
  });

  it('lists the roles that owe a repair, the one updated longest ago first', async () => {
    const { sweeps } = harness();
    const owners: string[] = [];
    for (const [slug, updatedAt] of [
      ['owner-newest', NEWEST],
      ['owner-oldest', OLDEST],
      ['owner-middle', MIDDLE],
    ] as const) {
      const id = await harness().seedRole({
        name: slug,
        slug,
        permissions: [],
        createdAt: updatedAt,
      });
      await harness().oweRepair(id, {
        roleId: id,
        previousSlug: `${slug}-before`,
        actorId: fixture().adminId,
      });
      owners.push(id);
    }
    const [newest, oldest, middle] = owners;
    const order = async (limit: number) =>
      (await sweeps.listSweepOwners(limit)).map((owner) => owner.id);

    const all = await order(16);
    const firstTwo = await order(2);
    await sweeps.rotateSweepOwner(oldest, new Date('2098-01-04T00:00:00.000Z'));
    await sweeps.rotateSweepOwner(
      fixture().editorRoleId,
      new Date('2097-01-01T00:00:00.000Z'),
    );

    expect({ all, firstTwo, afterRotation: await order(16) }).toEqual({
      all: [oldest, middle, newest],
      firstTwo: [oldest, middle],
      afterRotation: [middle, newest, oldest],
    });
  });

  it('keeps a deletion on record until its repair is complete', async () => {
    const { changes, sweeps } = harness();
    const gone = await harness().seedRole({
      name: 'Gone',
      slug: GONE_SLUG,
      permissions: [],
    });
    const deletion = {
      roleId: gone,
      previousSlug: GONE_SLUG,
      actorId: fixture().adminId,
      sweepId: 'deletion',
    };

    await inUnitOfWork((unitOfWork) =>
      changes.appendRoleDeletion(unitOfWork, deletion),
    );
    const pending = await sweeps.listPendingDeletions(16);
    await sweeps.completeDeletion(gone);
    const record = await inUnitOfWork((unitOfWork) =>
      sweeps.readDeletionRecord(unitOfWork, gone),
    );

    expect({
      pending,
      afterCompletion: await sweeps.listPendingDeletions(16),
      record: record && {
        roleId: record.roleId,
        previousSlug: record.previousSlug,
        actorId: record.actorId,
        sweepId: record.sweepId,
      },
      neverDeleted: await inUnitOfWork((unitOfWork) =>
        sweeps.readDeletionRecord(unitOfWork, fixture().editorRoleId),
      ),
    }).toEqual({
      pending: [deletion],
      afterCompletion: [],
      record: deletion,
      neverDeleted: null,
    });
  });

  it('returns the holders of a deleted role to the role each held before', async () => {
    const { roles } = servicesOn(harness());
    const gone = await roles.create(
      { name: 'Gone', permissions: [READ_POSTS] },
      fixture().adminId,
    );
    await roles.delete(GONE_SLUG, fixture().adminId);
    const manager = (await harness().role(MANAGER_SLUG))?.id ?? 'no manager';
    const hadManager = await harness().seedAccount({ role: GONE_SLUG });
    const hadDeletedRole = await harness().seedAccount({ role: GONE_SLUG });
    const noHistory = await harness().seedAccount({ role: GONE_SLUG });
    const bystander = await harness().seedAccount({ role: EDITOR_SLUG });
    await harness().seedAssignment({
      userId: hadManager,
      assignedRoleId: manager,
      previousRoleId: fixture().editorRoleId,
      sessionVersion: 1,
    });
    await harness().seedAssignment({
      userId: hadManager,
      assignedRoleId: gone.id,
      previousRoleId: manager,
      sessionVersion: 2,
    });
    await harness().seedAssignment({
      userId: hadDeletedRole,
      assignedRoleId: gone.id,
      previousRoleId: harness().absentId(),
      sessionVersion: 1,
    });

    const moved = await sweepRoleHolders(
      {
        runner: harness().runner(rerunAtOnce),
        changes: harness().changes,
        sweeps: harness().sweeps,
      },
      {
        roleId: gone.id,
        previousSlug: GONE_SLUG,
        actorId: fixture().managerId,
        logger: new Logger('RoleContract'),
      },
    );

    expect({
      moved,
      accounts: await accountsOf(harness(), [
        hadManager,
        hadDeletedRole,
        noHistory,
        bystander,
      ]),
      revocations: await revocationsOf(harness()),
    }).toEqual({
      moved: 3,
      accounts: [
        { role: MANAGER_SLUG, sessionVersion: 1 },
        { role: DEFAULT_SLUG, sessionVersion: 1 },
        { role: DEFAULT_SLUG, sessionVersion: 1 },
        { role: EDITOR_SLUG, sessionVersion: 0 },
      ],
      revocations: [hadManager, hadDeletedRole, noHistory]
        .map((holder) => `${holder} by ${fixture().adminId} (${ADMIN_FORCED})`)
        .sort(),
    });
  });
}
