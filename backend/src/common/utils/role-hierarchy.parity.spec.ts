import { HttpException } from '@nestjs/common';
import {
  canManageLevel,
  canModifyLevel,
  hasMinimumRole,
  isAdminRole,
  isValidRoleAssignment,
  LevelActor,
  seededRoleLevel,
  UNKNOWN_ROLE_LEVEL,
} from './role-hierarchy';
import { resolveRoleLevel } from '../../role/utils/role.util';
import { assertOutranksRole } from '../../role/utils/role-actor.util';

/**
 * Today's role checks with the default HOST_ROLES. Every table is written by
 * hand from the rules at c06e6233: user 1, support 2, manager 3, admin 4, a
 * stored custom role with no level at 1, and a slug with no stored role at 0.
 * Rows are the actor (or the first argument), columns follow SLUGS, and
 * `x` is yes, `-` is no.
 */
const CUSTOM = 'content-editor';
const GHOST = 'ghost';
const SLUGS = ['user', 'support', 'manager', 'admin', CUSTOM, GHOST];

/** The level the role checks see: a stored role's level, or 0 for a slug with no role. */
function levelSeen(slug: string): number {
  return slug === GHOST ? UNKNOWN_ROLE_LEVEL : resolveRoleLevel({ slug });
}

/** The acting account on this slug, as the level checks see it. */
function actorOn(slug: string): LevelActor {
  return { level: levelSeen(slug), isAdmin: isAdminRole(slug) };
}

function table(decide: (row: string, column: string) => boolean) {
  return Object.fromEntries(
    SLUGS.map((row) => [
      row,
      SLUGS.map((column) => (decide(row, column) ? 'x' : '-')).join(' '),
    ]),
  );
}

function outranks(actor: string, role: string): boolean {
  try {
    assertOutranksRole({ ...actorOn(actor), permissions: [] }, { slug: role });
    return true;
  } catch (error) {
    if (error instanceof HttpException) return false;
    throw error;
  }
}

describe('role checks with the default host roles, as before', () => {
  it('resolves the level of each slug', () => {
    expect(
      Object.fromEntries(
        SLUGS.map((slug) => [slug, resolveRoleLevel({ slug })]),
      ),
    ).toEqual({
      user: 1,
      support: 2,
      manager: 3,
      admin: 4,
      [CUSTOM]: 1,
      [GHOST]: 1,
    });
  });

  it('keeps a stored level ahead of the seeded one', () => {
    expect(resolveRoleLevel({ slug: 'support', level: 3 })).toBe(3);
  });

  it('compares slugs by minimum role, unknown and custom slugs at 0', () => {
    expect(table(hasMinimumRole)).toEqual({
      user: 'x - - - x x',
      support: 'x x - - x x',
      manager: 'x x x - x x',
      admin: 'x x x x x x',
      [CUSTOM]: '- - - - x x',
      [GHOST]: '- - - - x x',
    });
  });

  it('lets an actor read a peer or a lower role, and a stranded slug only as admin', () => {
    expect(
      table((actor, target) =>
        canManageLevel(actorOn(actor), levelSeen(target)),
      ),
    ).toEqual({
      user: 'x - - - x -',
      support: 'x x - - x -',
      manager: 'x x x - x -',
      admin: 'x x x x x x',
      [CUSTOM]: 'x - - - x -',
      [GHOST]: '- - - - - -',
    });
  });

  it('lets an actor change only a lower role, and a stranded slug only as admin', () => {
    expect(
      table((actor, target) =>
        canModifyLevel(actorOn(actor), levelSeen(target)),
      ),
    ).toEqual({
      user: '- - - - - -',
      support: 'x - - - x -',
      manager: 'x x - - x -',
      admin: 'x x x - x x',
      [CUSTOM]: '- - - - - -',
      [GHOST]: '- - - - - -',
    });
  });

  it('lets an actor without the wildcard edit only a role below it', () => {
    expect(table(outranks)).toEqual({
      user: '- - - - - -',
      support: 'x - - - x x',
      manager: 'x x - - x x',
      admin: 'x x x - x x',
      [CUSTOM]: '- - - - - -',
      [GHOST]: '- - - - - -',
    });
  });

  it('lets a wildcard holder edit every role', () => {
    expect(
      SLUGS.map((role) => {
        assertOutranksRole(
          { level: 1, isAdmin: false, permissions: ['*'] },
          { slug: role },
        );
        return role;
      }),
    ).toEqual(SLUGS);
  });

  it('assigns every role through the API except admin', () => {
    expect(SLUGS.filter((slug) => !isValidRoleAssignment(slug))).toEqual([
      'admin',
    ]);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'treats the slug %s as an unseeded role, not as an object member',
    (slug) => {
      expect({
        seeded: seededRoleLevel(slug),
        resolved: resolveRoleLevel({ slug }),
        reachesUser: hasMinimumRole(slug, 'user'),
        reachedByUser: hasMinimumRole('user', slug),
      }).toEqual({
        seeded: undefined,
        resolved: 1,
        reachesUser: false,
        reachedByUser: true,
      });
    },
  );
});
