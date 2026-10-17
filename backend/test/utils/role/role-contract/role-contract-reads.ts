import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import {
  rejectionOf,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  ADMIN_SLUG,
  answerOf,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  MANAGER_SLUG,
  READ_POSTS,
  RoleFixture,
  RoleHarnessSource,
  servicesOn,
} from './role-contract-support';

/** Reads that change nothing: lookups, the list, holder counts and levels. */
export function roleReadCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  const roles = () => servicesOn(harness()).roles;
  const hierarchy = () => servicesOn(harness()).hierarchy;

  it('finds a role by the id it was given and by its slug', async () => {
    const byId = await roles().findOne(fixture().editorRoleId);
    const bySlug = await roles().findOne(EDITOR_SLUG);
    const missing = await rejectionOf(roles().findOne(harness().absentId()));
    const foreign = await rejectionOf(roles().findOne(harness().foreignId()));

    expect({
      byId: { id: byId.id, slug: byId.slug, level: byId.level },
      bySlug: bySlug.id,
      missing: answerOf(missing),
      foreign: answerOf(foreign),
    }).toEqual({
      byId: { id: fixture().editorRoleId, slug: EDITOR_SLUG, level: 1 },
      bySlug: fixture().editorRoleId,
      missing: { code: ErrorCode.ROLE_NOT_FOUND, status: 404 },
      foreign: { code: ErrorCode.ROLE_NOT_FOUND, status: 404 },
    });
  });

  it('reads hierarchy levels with the fallbacks for older roles', async () => {
    await harness().seedRole({
      name: 'Support',
      slug: 'support',
      permissions: [],
    });
    const missing = await rejectionOf(hierarchy().getLevelOrFail('ghost'));

    expect({
      stored: await hierarchy().getLevel(MANAGER_SLUG),
      seedMap: await hierarchy().getLevel('support'),
      custom: await hierarchy().getLevel(EDITOR_SLUG),
      unknown: await hierarchy().getLevel('ghost'),
      mustExist: await hierarchy().getLevelOrFail(ADMIN_SLUG),
      missing: answerOf(missing),
      atOrBelowTwo: (await hierarchy().getSlugsAtOrBelow(2)).sort(),
      atOrBelowZero: await hierarchy().getSlugsAtOrBelow(0),
    }).toEqual({
      stored: 3,
      seedMap: 2,
      custom: 1,
      unknown: 0,
      mustExist: 4,
      missing: { code: ErrorCode.ROLE_NOT_FOUND, status: 404 },
      atOrBelowTwo: [EDITOR_SLUG, 'support', DEFAULT_SLUG].sort(),
      atOrBelowZero: [],
    });
  });

  it('reads a level inside a unit of work that the committed read cannot see yet', async () => {
    const levels = await harness()
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        await harness().changes.insertCustomRole(unitOfWork, {
          name: 'Draft',
          slug: 'draft',
          level: 2,
          permissions: [READ_POSTS],
        });
        return {
          inWork: await hierarchy().getLevel('draft', unitOfWork),
          committed: await hierarchy().getLevel('draft'),
        };
      });

    expect({
      levels,
      afterCommit: await hierarchy().getLevel('draft'),
    }).toEqual({
      levels: { inWork: 2, committed: 0 },
      afterCommit: 2,
    });
  });
}
