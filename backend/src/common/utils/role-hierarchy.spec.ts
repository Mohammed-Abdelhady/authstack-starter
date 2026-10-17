import {
  canManageLevel,
  canModifyLevel,
  isAdminRole,
  LevelActor,
  UNKNOWN_ROLE_LEVEL,
  buildRoleHierarchy,
} from './role-hierarchy';
import { HostRole, ROLE_AUDIENCE } from '../../host/types/host-role.type';

/** An actor on a role other than admin, at this level. */
const actorAt = (level: number): LevelActor => ({ level, isAdmin: false });
const ADMIN: LevelActor = { level: 4, isAdmin: true };

describe('Role Hierarchy Utilities', () => {
  describe('isAdminRole', () => {
    it('names only the admin role slug, whatever level another role holds', () => {
      expect(
        ['admin', 'manager', 'content-chief', 'Admin', ''].filter(isAdminRole),
      ).toEqual(['admin']);
    });
  });

  describe('canManageLevel (non-strict, reads)', () => {
    it('should reserve stranded roles for the admin role, not its level', () => {
      expect(canManageLevel(actorAt(3), UNKNOWN_ROLE_LEVEL)).toBe(false);
      expect(canManageLevel(actorAt(6), UNKNOWN_ROLE_LEVEL)).toBe(false);
      expect(canManageLevel(ADMIN, UNKNOWN_ROLE_LEVEL)).toBe(true);
    });
  });

  describe('canModifyLevel (strict, mutations)', () => {
    it('should reserve stranded roles for the admin role, not its level', () => {
      expect(canModifyLevel(actorAt(3), UNKNOWN_ROLE_LEVEL)).toBe(false);
      expect(canModifyLevel(actorAt(6), UNKNOWN_ROLE_LEVEL)).toBe(false);
      expect(canModifyLevel(ADMIN, UNKNOWN_ROLE_LEVEL)).toBe(true);
    });
  });

  describe('buildRoleHierarchy', () => {
    const hostRole = (slug: string, level: number): HostRole => ({
      name: slug,
      slug,
      level,
      audience: ROLE_AUDIENCE.STAFF,
      permissions: [],
      description: slug,
    });

    it('holds only the core roles for an empty host list', () => {
      expect(buildRoleHierarchy([])).toEqual({ user: 1, admin: 4 });
    });

    it('keeps admin above a host role that reaches its level', () => {
      expect(buildRoleHierarchy([hostRole('editor', 6)])).toEqual({
        user: 1,
        editor: 6,
        admin: 7,
      });
    });

    it.each([
      ['a level of 0', [hostRole('editor', 0)]],
      ['a fractional level', [hostRole('editor', 1.5)]],
      ['the core user slug', [hostRole('user', 2)]],
      ['the core admin slug', [hostRole('admin', 2)]],
      ['a slug used twice', [hostRole('editor', 2), hostRole('editor', 3)]],
      ['the user slug in capitals', [hostRole('User', 2)]],
      ['the user slug with spaces', [hostRole(' user ', 2)]],
      ['an empty slug', [hostRole('', 2)]],
      [
        'a slug that differs from another only in case',
        [hostRole('editor', 2), hostRole('Editor', 3)],
      ],
      ['a level above the highest one', [hostRole('editor', 2_147_483_647)]],
      ['a level past the safe integers', [hostRole('editor', 2 ** 53)]],
    ])('refuses a host role with %s', (_, roles) => {
      expect(() => buildRoleHierarchy(roles)).toThrow('Host role');
    });

    it('accepts the highest host level and puts admin one above it', () => {
      expect(buildRoleHierarchy([hostRole('owner', 2_147_483_646)])).toEqual({
        user: 1,
        owner: 2_147_483_646,
        admin: 2_147_483_647,
      });
    });
  });
});
