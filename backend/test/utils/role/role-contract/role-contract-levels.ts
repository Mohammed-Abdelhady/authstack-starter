import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  ADMIN_SLUG,
  answerOf,
  CREATE_ROLES,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  LEAD_SLUG,
  READ_POSTS,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
  WILDCARD,
} from './role-contract-support';

const HOST_PERMISSION = 'orders:refund:all';
const HIERARCHY_REFUSAL = {
  code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
  status: 403,
};
const PROTECTED_REFUSAL = { code: ErrorCode.ROLE_PROTECTED, status: 403 };

/** Host permissions on a role, and the level a caller may give a role. */
export function roleLevelCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const roles = () => servicesOn(harness()).roles;
  const storedLevel = async (slug: string) =>
    (await harness().role(slug))?.level;

  async function seedLead(): Promise<void> {
    await harness().seedRole({
      name: 'Content Lead',
      slug: LEAD_SLUG,
      level: 2,
      permissions: [READ_POSTS],
    });
  }

  it('stores a role holding a host permission no core list names', async () => {
    const created = await roles().create(
      { name: 'Refunds', permissions: [HOST_PERMISSION] },
      fixture().adminId,
    );

    expect({
      answer: created.permissions,
      stored: (await harness().role('refunds'))?.permissions,
    }).toEqual({ answer: [HOST_PERMISSION], stored: [HOST_PERMISSION] });
  });

  it('refuses a level-one holder of the create permission, whose default level is its own', async () => {
    const delegate = await harness().seedAccount({
      role: EDITOR_SLUG,
      permissions: [CREATE_ROLES],
    });

    const failure = await rejectionOf(
      roles().create({ name: 'Orphan', permissions: [READ_POSTS] }, delegate),
    );

    expect({
      answer: answerOf(failure),
      stored: await harness().role('orphan'),
    }).toEqual({
      answer: { code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE, status: 403 },
      stored: null,
    });
  });

  it('stores the level a caller gives below their own', async () => {
    const created = await roles().create(
      { name: 'Post Lead', permissions: [READ_POSTS], level: 2 },
      fixture().managerId,
    );

    expect({
      answer: created.level,
      stored: await storedLevel('post-lead'),
    }).toEqual({ answer: 2, stored: 2 });
  });

  it.each([
    ['the manager', 'managerId', 3],
    ['the manager', 'managerId', 4],
    ['a wildcard admin', 'adminId', 4],
  ] as const)(
    'refuses %s creating a role at level %i',
    async (_, actor, level) => {
      const failure = await rejectionOf(
        roles().create(
          { name: 'Too High', permissions: [READ_POSTS], level },
          fixture()[actor],
        ),
      );

      expect({
        answer: answerOf(failure),
        stored: await harness().role('too-high'),
      }).toEqual({ answer: HIERARCHY_REFUSAL, stored: null });
    },
  );

  it.each([
    ['who may create roles', [CREATE_ROLES, READ_POSTS]],
    ['holding the wildcard', [WILDCARD]],
  ])(
    'refuses a level-1 caller %s creating a role with no level',
    async (_, permissions) => {
      const callerId = await harness().seedAccount({
        role: DEFAULT_SLUG,
        permissions,
      });

      const failure = await rejectionOf(
        roles().create(
          { name: 'Same Level', permissions: [READ_POSTS] },
          callerId,
        ),
      );

      expect({
        answer: answerOf(failure),
        stored: await harness().role('same-level'),
      }).toEqual({ answer: HIERARCHY_REFUSAL, stored: null });
    },
  );

  it('keeps the level when an update leaves it out', async () => {
    await seedLead();

    const answer = await roles().update(
      LEAD_SLUG,
      { description: 'Leads content' },
      fixture().managerId,
    );

    expect({
      answer: answer.level,
      stored: await storedLevel(LEAD_SLUG),
    }).toEqual({ answer: 2, stored: 2 });
  });

  it.each([
    [LEAD_SLUG, 1],
    [EDITOR_SLUG, 2],
  ])('moves %s to level %i below the caller', async (slug, level) => {
    await seedLead();

    const answer = await roles().update(slug, { level }, fixture().managerId);

    expect({
      answer: answer.level,
      stored: await storedLevel(slug),
    }).toEqual({ answer: level, stored: level });
  });

  it.each([3, 4])(
    'refuses the manager moving a role to level %i',
    async (level) => {
      await seedLead();

      const failure = await rejectionOf(
        roles().update(LEAD_SLUG, { level }, fixture().managerId),
      );

      expect({
        answer: answerOf(failure),
        stored: await storedLevel(LEAD_SLUG),
      }).toEqual({ answer: HIERARCHY_REFUSAL, stored: 2 });
    },
  );

  it.each([
    [ADMIN_SLUG, 3, 4],
    [DEFAULT_SLUG, 2, 1],
  ])(
    'refuses a new level on the system role %s',
    async (slug, level, seeded) => {
      const failure = await rejectionOf(
        roles().update(slug, { level }, fixture().adminId),
      );

      expect({
        answer: answerOf(failure),
        stored: await storedLevel(slug),
      }).toEqual({ answer: PROTECTED_REFUSAL, stored: seeded });
    },
  );

  it('accepts a system role edit that repeats its level', async () => {
    const answer = await roles().update(
      DEFAULT_SLUG,
      { description: 'Everyone', level: 1 },
      fixture().adminId,
    );

    expect({
      answer: { level: answer.level, description: answer.description },
      stored: await storedLevel(DEFAULT_SLUG),
    }).toEqual({ answer: { level: 1, description: 'Everyone' }, stored: 1 });
  });
}
