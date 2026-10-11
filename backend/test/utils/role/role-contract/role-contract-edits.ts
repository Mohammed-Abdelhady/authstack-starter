import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  accountsOf,
  ADMIN_FORCED,
  answerOf,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  LEAD_SLUG,
  READ_POSTS,
  revocationsOf,
  REVOKED_ALL,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
  UPDATE_ROLES,
} from './role-contract-support';

/** What an edit or a delete does to the role's holders. */
export function roleEditCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const roles = () => servicesOn(harness()).roles;

  it('moves every holder and ends its sessions when a role is renamed', async () => {
    const first = await harness().seedAccount({ role: EDITOR_SLUG });
    const second = await harness().seedAccount({ role: EDITOR_SLUG });
    const bystander = await harness().seedAccount({ role: DEFAULT_SLUG });

    const answer = await roles().update(
      EDITOR_SLUG,
      { name: 'Content Lead' },
      fixture().adminId,
    );

    expect({
      answer: { slug: answer.slug, usersMoved: answer.usersMoved },
      old: await harness().role(EDITOR_SLUG),
      renamed: await harness().role(LEAD_SLUG),
      accounts: await accountsOf(harness(), [first, second, bystander]),
      revocations: await revocationsOf(harness()),
    }).toEqual({
      answer: { slug: LEAD_SLUG, usersMoved: 2 },
      old: null,
      renamed: {
        id: fixture().editorRoleId,
        name: 'Content Lead',
        slug: LEAD_SLUG,
        description: null,
        level: null,
        permissions: [READ_POSTS],
        isSystemRole: false,
        isProtected: false,
        owedRepairs: [],
      },
      accounts: [
        { role: LEAD_SLUG, sessionVersion: 1 },
        { role: LEAD_SLUG, sessionVersion: 1 },
        { role: DEFAULT_SLUG, sessionVersion: 0 },
      ],
      revocations: [
        `${first} by ${fixture().adminId} (${ADMIN_FORCED})`,
        `${second} by ${fixture().adminId} (${ADMIN_FORCED})`,
      ].sort(),
    });
  });

  it('ends holder sessions without moving them when permissions change', async () => {
    const holder = await harness().seedAccount({ role: EDITOR_SLUG });

    const answer = await roles().update(
      EDITOR_SLUG,
      { permissions: [READ_POSTS, UPDATE_ROLES] },
      fixture().adminId,
    );

    expect({
      usersMoved: answer.usersMoved,
      permissions: (await harness().role(EDITOR_SLUG))?.permissions,
      holder: await harness().account(holder),
      revocations: (await harness().events()).map((event) => event.action),
    }).toEqual({
      usersMoved: 0,
      permissions: [READ_POSTS, UPDATE_ROLES],
      holder: { role: EDITOR_SLUG, sessionVersion: 1 },
      revocations: [REVOKED_ALL],
    });
  });

  it('leaves holders signed in when only the description changes', async () => {
    const holder = await harness().seedAccount({ role: EDITOR_SLUG });

    await roles().update(
      EDITOR_SLUG,
      { description: 'Edits content', permissions: [READ_POSTS] },
      fixture().adminId,
    );

    expect({
      description: (await harness().role(EDITOR_SLUG))?.description,
      holder: await harness().account(holder),
      events: await harness().events(),
    }).toEqual({
      description: 'Edits content',
      holder: { role: EDITOR_SLUG, sessionVersion: 0 },
      events: [],
    });
  });

  it('deletes only an unprotected role nobody holds', async () => {
    await harness().seedRole({
      name: 'Unused',
      slug: 'unused',
      permissions: [READ_POSTS],
    });
    await harness().seedAccount({ role: EDITOR_SLUG });
    await harness().seedAccount({ role: EDITOR_SLUG });
    const remove = (slug: string) => roles().delete(slug, fixture().adminId);

    const held = await rejectionOf(remove(EDITOR_SLUG));
    const protectedRole = await rejectionOf(remove(DEFAULT_SLUG));
    const missing = await rejectionOf(remove('ghost'));
    await remove('unused');

    expect({
      held: {
        ...answerOf(held),
        details: held instanceof Error ? Reflect.get(held, 'details') : held,
      },
      protectedRole: answerOf(protectedRole),
      missing: answerOf(missing),
      stillThere: (await harness().role(EDITOR_SLUG))?.slug,
      unused: await harness().role('unused'),
    }).toEqual({
      held: {
        code: ErrorCode.ROLE_HAS_USERS,
        status: 400,
        details: { count: 2 },
      },
      protectedRole: { code: ErrorCode.ROLE_PROTECTED, status: 403 },
      missing: { code: ErrorCode.ROLE_NOT_FOUND, status: 404 },
      stillThere: EDITOR_SLUG,
      unused: null,
    });
  });
}
