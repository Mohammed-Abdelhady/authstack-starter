import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { ROLE_CONSTRAINT } from '../../../../src/role/stores/role-records';
import {
  rejectionOf,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  answerOf,
  EDITOR_SLUG,
  MANAGER_SLUG,
  READ_POSTS,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

function conflictOf(error: unknown): string {
  return error instanceof UniqueConflictError
    ? error.constraint
    : `not a unique conflict: ${String(error)}`;
}

/** What crosses the seam: ids as opaque strings, and the shared errors. */
export function roleSeamCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const inUnitOfWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);

  it('hands ids out and takes them back as the same strings', async () => {
    const created = await inUnitOfWork((unitOfWork) =>
      harness().changes.insertCustomRole(unitOfWork, {
        name: 'Opaque',
        slug: 'opaque',
        level: 1,
        permissions: [READ_POSTS],
      }),
    );
    const again = await inUnitOfWork(async (unitOfWork) => ({
      read: (await harness().changes.readRole(unitOfWork, created.id))?.id,
      taken: (await harness().changes.takeRoleForChange(unitOfWork, created.id))
        ?.id,
      bySlug: (await harness().changes.readRoleBySlug(unitOfWork, 'opaque'))
        ?.id,
    }));

    expect({
      isText: typeof created.id,
      again,
      catalog: (await harness().catalog.findRole(created.id))?.id,
      stored: (await harness().role('opaque'))?.id,
      absent: await inUnitOfWork((unitOfWork) =>
        harness().changes.readRole(unitOfWork, harness().absentId()),
      ),
    }).toEqual({
      isText: 'string',
      again: { read: created.id, taken: created.id, bySlug: created.id },
      catalog: created.id,
      stored: created.id,
      absent: null,
    });
  });

  it.each([
    ['a word', () => 'not-an-id'],
    ['an empty string', () => ''],
    ["the other database's id", () => harness().foreignId()],
  ])(
    'refuses %s as an id in every method that takes one',
    async (_, malformed) => {
      const id = malformed();
      const editor = fixture().editorRoleId;
      const sweep = { roleId: id, previousSlug: EDITOR_SLUG, actorId: 'actor' };
      const attempts: Record<string, (work: UnitOfWork) => Promise<unknown>> = {
        readActor: (work) => harness().changes.readActor(work, id),
        readRole: (work) => harness().changes.readRole(work, id),
        takeRoleForChange: (work) =>
          harness().changes.takeRoleForChange(work, id),
        saveRoleEdit: (work) => harness().changes.saveRoleEdit(work, id, {}),
        savePendingSweeps: (work) =>
          harness().changes.savePendingSweeps(work, editor, [sweep]),
        removeRole: (work) => harness().changes.removeRole(work, id),
        moveHolders: (work) =>
          harness().changes.moveHolders(work, {
            fromSlugs: [EDITOR_SLUG],
            toSlug: MANAGER_SLUG,
            holderIds: [id],
          }),
        readDeletionRecord: (work) =>
          harness().sweeps.readDeletionRecord(work, id),
        findPendingSweepActor: (work) =>
          harness().sweeps.findPendingSweepActor(work, id, EDITOR_SLUG),
        readPreviousRoles: (work) =>
          harness().sweeps.readPreviousRoles(work, [fixture().adminId], id),
        fenceDestination: (work) => harness().sweeps.fenceDestination(work, id),
      };

      const refused: string[] = [];
      for (const [method, attempt] of Object.entries(attempts)) {
        const failure = await rejectionOf(inUnitOfWork(attempt));
        if (failure instanceof MalformedIdError) refused.push(method);
      }

      expect(refused).toEqual(Object.keys(attempts));
    },
  );

  it('names the slug rule when two roles are given one slug', async () => {
    const insert = await rejectionOf(
      inUnitOfWork((unitOfWork) =>
        harness().changes.insertCustomRole(unitOfWork, {
          name: 'Another Editor',
          slug: EDITOR_SLUG,
          level: 1,
          permissions: [READ_POSTS],
        }),
      ),
    );
    const rename = await rejectionOf(
      inUnitOfWork(async (unitOfWork) => {
        await harness().changes.takeRoleForChange(
          unitOfWork,
          fixture().editorRoleId,
        );
        return harness().changes.saveRoleEdit(
          unitOfWork,
          fixture().editorRoleId,
          { slug: MANAGER_SLUG },
        );
      }),
    );

    expect({
      insert: conflictOf(insert),
      rename: conflictOf(rename),
      stored: (await harness().role(EDITOR_SLUG))?.name,
    }).toEqual({
      insert: ROLE_CONSTRAINT.SLUG,
      rename: ROLE_CONSTRAINT.SLUG,
      stored: 'Content Editor',
    });
  });

  it('answers a slug taken after the service looked as a taken name', async () => {
    const edit = servicesOn(harness()).edit;

    const created = await rejectionOf(
      edit.create(
        { name: 'Content Editor', permissions: [READ_POSTS] },
        EDITOR_SLUG,
        fixture().adminId,
      ),
    );
    const renamed = await rejectionOf(
      edit.commit(
        fixture().editorRoleId,
        { name: 'Manager' },
        fixture().adminId,
      ),
    );

    expect({
      created: answerOf(created),
      renamed: answerOf(renamed),
    }).toEqual({
      created: { code: ErrorCode.ROLE_NAME_TAKEN, status: 409 },
      renamed: { code: ErrorCode.ROLE_NAME_TAKEN, status: 409 },
    });
  });

  it('refuses a blank name and a blank slug each on its own', async () => {
    const editor = fixture().editorRoleId;
    const refusalOf = async (edit: { name?: string; slug?: string }) => {
      const failure = await rejectionOf(
        inUnitOfWork(async (unitOfWork) => {
          await harness().changes.takeRoleForChange(unitOfWork, editor);
          return harness().changes.saveRoleEdit(unitOfWork, editor, edit);
        }),
      );
      return failure instanceof Error ? failure.name : 'not an error';
    };

    expect({
      blankName: await refusalOf({ name: '   ' }),
      blankSlug: await refusalOf({ slug: '   ' }),
      stored: await harness().role(EDITOR_SLUG),
    }).toMatchObject({
      blankName: 'RoleFieldsRejectedError',
      blankSlug: 'RoleFieldsRejectedError',
      stored: { name: 'Content Editor', slug: EDITOR_SLUG },
    });
  });

  it('refuses a blank name as a field error and stores nothing', async () => {
    const failure = await rejectionOf(
      servicesOn(harness()).roles.update(
        EDITOR_SLUG,
        { name: '   ' },
        fixture().adminId,
      ),
    );

    expect({
      answer: answerOf(failure),
      stored: (await harness().role(EDITOR_SLUG))?.name,
    }).toEqual({
      answer: { code: ErrorCode.VALIDATION_ERROR, status: 400 },
      stored: 'Content Editor',
    });
  });
}
