import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import {
  rejectionOf,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  accountsOf,
  ADMIN_FORCED,
  answerOf,
  DELETE_USERS,
  EDITOR_SLUG,
  LEAD_SLUG,
  READ_POSTS,
  revocationsOf,
  REVOKED_ALL,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

class WorkAbandoned extends Error {}

/** A role edit, its holder move and their events are stored together or not at all. */
export function roleAtomicityCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const inUnitOfWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);

  async function storedEdit(holders: string[]) {
    return {
      editor: await harness().role(EDITOR_SLUG),
      renamed: await harness().role(LEAD_SLUG),
      accounts: await accountsOf(harness(), holders),
      revocations: await revocationsOf(harness()),
    };
  }

  const untouched = (editorRoleId: string) => ({
    editor: {
      id: editorRoleId,
      name: 'Content Editor',
      slug: EDITOR_SLUG,
      description: null,
      level: null,
      permissions: [READ_POSTS],
      isSystemRole: false,
      isProtected: false,
      owedRepairs: [],
    },
    renamed: null,
    accounts: [
      { role: EDITOR_SLUG, sessionVersion: 0 },
      { role: EDITOR_SLUG, sessionVersion: 0 },
    ],
    revocations: [],
  });

  it.each([
    ['a rename', { name: 'Content Lead' }],
    ['a permission change', { permissions: [READ_POSTS, DELETE_USERS] }],
  ])(
    'stores nothing of %s whose security events the database refuses',
    async (_, edit) => {
      const holders = [
        await harness().seedAccount({ role: EDITOR_SLUG }),
        await harness().seedAccount({ role: EDITOR_SLUG }),
      ];
      const allowEvents = await harness().refuseSecurityEvents();

      let failure: unknown;
      try {
        failure = await rejectionOf(
          servicesOn(harness()).roles.update(
            EDITOR_SLUG,
            edit,
            fixture().adminId,
          ),
        );
      } finally {
        allowEvents();
      }

      // Today every unique conflict inside a role edit is answered as a taken
      // name, the refused event included. Both databases must agree on it.
      expect({
        answer: answerOf(failure),
        stored: await storedEdit(holders),
      }).toEqual({
        answer: { code: ErrorCode.ROLE_NAME_TAKEN, status: 409 },
        stored: untouched(fixture().editorRoleId),
      });
    },
  );

  it('rolls the role and its holders back when the work throws after both were written', async () => {
    const holders = [
      await harness().seedAccount({ role: EDITOR_SLUG }),
      await harness().seedAccount({ role: EDITOR_SLUG }),
    ];
    const seen: { moved?: number } = {};

    const failure = await rejectionOf(
      inUnitOfWork(async (unitOfWork) => {
        const { changes } = harness();
        await changes.takeRoleForChange(unitOfWork, fixture().editorRoleId);
        await changes.saveRoleEdit(unitOfWork, fixture().editorRoleId, {
          name: 'Content Lead',
          slug: LEAD_SLUG,
        });
        const moved = await changes.moveHolders(unitOfWork, {
          fromSlugs: [EDITOR_SLUG],
          toSlug: LEAD_SLUG,
        });
        seen.moved = moved.holderIds.length;
        await changes.appendHolderRevocations(
          unitOfWork,
          moved.holderIds.map((targetUserId) => ({
            targetUserId,
            actorId: fixture().adminId,
            action: REVOKED_ALL,
            reasonCode: ADMIN_FORCED,
          })),
        );
        throw new WorkAbandoned('abandoned after every write');
      }),
    );

    expect({
      rethrownAsItself: failure instanceof WorkAbandoned,
      movedInsideTheWork: seen.moved,
      stored: await storedEdit(holders),
    }).toEqual({
      rethrownAsItself: true,
      movedInsideTheWork: 2,
      stored: untouched(fixture().editorRoleId),
    });
  });

  it('never commits work that swallowed a store failure', async () => {
    const holders = [
      await harness().seedAccount({ role: EDITOR_SLUG }),
      await harness().seedAccount({ role: EDITOR_SLUG }),
    ];
    const allowEvents = await harness().refuseSecurityEvents();

    let outcome: string;
    try {
      outcome = await inUnitOfWork(async (unitOfWork) => {
        const { changes } = harness();
        await changes.takeRoleForChange(unitOfWork, fixture().editorRoleId);
        await changes.saveRoleEdit(unitOfWork, fixture().editorRoleId, {
          name: 'Content Lead',
          slug: LEAD_SLUG,
        });
        try {
          await changes.appendHolderRevocations(unitOfWork, [
            {
              targetUserId: holders[0],
              actorId: fixture().adminId,
              action: REVOKED_ALL,
              reasonCode: ADMIN_FORCED,
            },
          ]);
        } catch {
          return 'swallowed the refused event';
        }
        return 'the event was stored';
      }).then(
        (returned) => `returned: ${returned}`,
        () => 'rejected',
      );
    } finally {
      allowEvents();
    }

    expect({ outcome, stored: await storedEdit(holders) }).toEqual({
      outcome: 'rejected',
      stored: untouched(fixture().editorRoleId),
    });
  });

  it('moves only the holders named and answers with exactly those', async () => {
    const named = await harness().seedAccount({ role: EDITOR_SLUG });
    const other = await harness().seedAccount({ role: EDITOR_SLUG });

    const moved = await inUnitOfWork((unitOfWork) =>
      harness().changes.moveHolders(unitOfWork, {
        fromSlugs: [EDITOR_SLUG],
        toSlug: LEAD_SLUG,
        holderIds: [named, harness().absentId()],
      }),
    );
    const nobody = await inUnitOfWork((unitOfWork) =>
      harness().changes.moveHolders(unitOfWork, {
        fromSlugs: ['ghost'],
        toSlug: LEAD_SLUG,
      }),
    );

    expect({
      moved,
      nobody,
      accounts: await accountsOf(harness(), [named, other]),
    }).toEqual({
      moved: { holderIds: [named], moved: 1 },
      nobody: { holderIds: [], moved: 0 },
      accounts: [
        { role: LEAD_SLUG, sessionVersion: 1 },
        { role: EDITOR_SLUG, sessionVersion: 0 },
      ],
    });
  });
}
