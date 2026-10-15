import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  ADMIN_SLUG,
  answerOf,
  CREATE_ROLES,
  DELETE_USERS,
  EDITOR_SLUG,
  MANAGER_SLUG,
  PEER_SLUG,
  READ_POSTS,
  revocationsOf,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
  WILDCARD,
} from './role-contract-support';

/** What an actor may create, edit and delete, and what each edit does to holders. */
export function roleRuleCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const roles = () => servicesOn(harness()).roles;

  it('stores a role audience at creation and retains it through edits', async () => {
    const created = await roles().create(
      { name: 'Staff Reader', permissions: [READ_POSTS], audience: 'staff' },
      fixture().managerId,
    );
    expect((await harness().catalog.findRole(created.id))?.audience).toBe(
      'staff',
    );

    await harness()
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        await harness().changes.takeRoleForChange(unitOfWork, created.id);
        await harness().changes.saveRoleEdit(unitOfWork, created.id, {
          description: 'Updated description',
        });
      });
    expect(await harness().catalog.findRole(created.id)).toMatchObject({
      audience: 'staff',
      description: 'Updated description',
    });
  });

  it('stores a custom role holding permissions the actor holds', async () => {
    const created = await roles().create(
      {
        name: 'Post Reader',
        description: 'Reads posts',
        permissions: [READ_POSTS, READ_POSTS],
      },
      fixture().managerId,
    );

    expect({
      answer: {
        slug: created.slug,
        level: created.level,
        permissions: created.permissions,
        isSystemRole: created.isSystemRole,
      },
      stored: await harness().role('post-reader'),
    }).toEqual({
      answer: {
        slug: 'post-reader',
        level: 1,
        permissions: [READ_POSTS],
        isSystemRole: false,
      },
      stored: {
        id: created.id,
        name: 'Post Reader',
        slug: 'post-reader',
        description: 'Reads posts',
        level: 1,
        permissions: [READ_POSTS],
        isSystemRole: false,
        isProtected: false,
        owedRepairs: [],
      },
    });
  });

  it.each([
    ['a permission the actor does not hold', [READ_POSTS, DELETE_USERS]],
    ['the wildcard from an actor without it', [WILDCARD]],
  ])('refuses to create a role with %s', async (_, permissions) => {
    const failure = await rejectionOf(
      roles().create({ name: 'Too Much', permissions }, fixture().managerId),
    );

    expect({
      answer: answerOf(failure),
      stored: await harness().role('too-much'),
    }).toEqual({
      answer: { code: ErrorCode.FORBIDDEN, status: 403 },
      stored: null,
    });
  });

  it('lets a wildcard holder hand out the wildcard', async () => {
    await roles().create(
      { name: 'Second Admin', permissions: [WILDCARD] },
      fixture().adminId,
    );

    expect((await harness().role('second-admin'))?.permissions).toEqual([
      WILDCARD,
    ]);
  });

  it('reads the actor inside the unit of work when creating', async () => {
    const reader = await harness().seedAccount({ role: EDITOR_SLUG });
    const deleted = await harness().seedAccount({
      role: ADMIN_SLUG,
      deleted: true,
    });
    const create = (actorId: string) =>
      rejectionOf(
        roles().create({ name: 'Nope', permissions: [READ_POSTS] }, actorId),
      );

    expect({
      withoutThePermission: answerOf(await create(reader)),
      deletedActor: answerOf(await create(deleted)),
      unknownActor: answerOf(await create(harness().absentId())),
      stored: await harness().role('nope'),
    }).toEqual({
      withoutThePermission: {
        code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
        status: 403,
      },
      deletedActor: { code: ErrorCode.SESSION_INVALID, status: 401 },
      unknownActor: { code: ErrorCode.SESSION_INVALID, status: 401 },
      stored: null,
    });
  });

  it('counts a permission the actor holds on the account itself', async () => {
    await harness().seedRole({
      name: 'Delegates',
      slug: 'delegates',
      level: 2,
      permissions: [READ_POSTS],
    });
    const delegate = await harness().seedAccount({
      role: 'delegates',
      permissions: [CREATE_ROLES],
    });

    await roles().create(
      { name: 'Delegated', permissions: [READ_POSTS] },
      delegate,
    );

    expect((await harness().role('delegated'))?.permissions).toEqual([
      READ_POSTS,
    ]);
  });

  it('refuses a name another role already has', async () => {
    const failure = await rejectionOf(
      roles().create(
        { name: 'Content Editor', permissions: [READ_POSTS] },
        fixture().adminId,
      ),
    );

    expect(answerOf(failure)).toEqual({
      code: ErrorCode.ROLE_NAME_TAKEN,
      status: 409,
    });
  });

  it('lets an actor edit only roles below its own level', async () => {
    await harness().seedRole({
      name: 'Regional Lead',
      slug: PEER_SLUG,
      level: 3,
      permissions: [READ_POSTS],
    });
    const edit = (slug: string, actorId: string) =>
      roles().update(slug, { description: 'edited' }, actorId);

    const peer = await rejectionOf(edit(PEER_SLUG, fixture().managerId));
    const own = await rejectionOf(edit(MANAGER_SLUG, fixture().managerId));
    await edit(EDITOR_SLUG, fixture().managerId);
    await edit(PEER_SLUG, fixture().adminId);
    await edit(ADMIN_SLUG, fixture().adminId);

    expect({
      peer: answerOf(peer),
      own: answerOf(own),
      descriptions: {
        editor: (await harness().role(EDITOR_SLUG))?.description,
        peer: (await harness().role(PEER_SLUG))?.description,
        manager: (await harness().role(MANAGER_SLUG))?.description,
        admin: (await harness().role(ADMIN_SLUG))?.description,
      },
    }).toEqual({
      peer: { code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE, status: 403 },
      own: { code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE, status: 403 },
      descriptions: {
        editor: 'edited',
        peer: 'edited',
        manager: null,
        admin: 'edited',
      },
    });
  });

  it('refuses an edit that adds a permission the actor does not hold', async () => {
    const holder = await harness().seedAccount({ role: EDITOR_SLUG });

    const failure = await rejectionOf(
      roles().update(
        EDITOR_SLUG,
        { permissions: [READ_POSTS, DELETE_USERS] },
        fixture().managerId,
      ),
    );

    expect({
      answer: answerOf(failure),
      permissions: (await harness().role(EDITOR_SLUG))?.permissions,
      holder: await harness().account(holder),
      revocations: await revocationsOf(harness()),
    }).toEqual({
      answer: { code: ErrorCode.FORBIDDEN, status: 403 },
      permissions: [READ_POSTS],
      holder: { role: EDITOR_SLUG, sessionVersion: 0 },
      revocations: [],
    });
  });

  it('keeps the wildcard on the admin role', async () => {
    const failure = await rejectionOf(
      roles().update(
        ADMIN_SLUG,
        { permissions: [READ_POSTS] },
        fixture().adminId,
      ),
    );

    expect({
      answer: answerOf(failure),
      permissions: (await harness().role(ADMIN_SLUG))?.permissions,
    }).toEqual({
      answer: { code: ErrorCode.ADMIN_WILDCARD_REQUIRED, status: 403 },
      permissions: [WILDCARD],
    });
  });
}
