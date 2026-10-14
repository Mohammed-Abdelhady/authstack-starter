import { UserRole } from '../../user/enums/user-role.enum';
import {
  hasMinimumRole,
  canManageLevel,
  canModifyLevel,
  isAdminRole,
  isValidRoleAssignment,
  CUSTOM_ROLE_LEVEL,
  LevelActor,
  ROLE_HIERARCHY,
  UNKNOWN_ROLE_LEVEL,
  buildRoleHierarchy,
  isCanonicalRoleSlug,
} from './role-hierarchy';
import { generateSlug } from '../../role/utils/role.util';
import { HostRole, ROLE_AUDIENCE } from '../../host/types/host-role.type';

/** An actor on a role other than admin, at this level. */
const actorAt = (level: number): LevelActor => ({ level, isAdmin: false });
const ADMIN: LevelActor = { level: 4, isAdmin: true };

describe('Role Hierarchy Utilities', () => {
  describe('ROLE_HIERARCHY', () => {
    it('should have correct hierarchy values', () => {
      expect(ROLE_HIERARCHY[UserRole.USER]).toBe(1);
      expect(ROLE_HIERARCHY[UserRole.SUPPORT]).toBe(2);
      expect(ROLE_HIERARCHY[UserRole.MANAGER]).toBe(3);
      expect(ROLE_HIERARCHY[UserRole.ADMIN]).toBe(4);
    });

    it('should place custom roles at the default level', () => {
      expect(CUSTOM_ROLE_LEVEL).toBe(ROLE_HIERARCHY[UserRole.USER]);
    });
  });

  describe('isAdminRole', () => {
    it('names only the admin role slug, whatever level another role holds', () => {
      expect(
        ['admin', 'manager', 'content-chief', 'Admin', ''].filter(isAdminRole),
      ).toEqual(['admin']);
    });
  });

  describe('hasMinimumRole', () => {
    it('should return true when user role is higher than required', () => {
      expect(hasMinimumRole(UserRole.ADMIN, UserRole.USER)).toBe(true);
      expect(hasMinimumRole(UserRole.MANAGER, UserRole.SUPPORT)).toBe(true);
    });

    it('should return true when user role equals required', () => {
      expect(hasMinimumRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
      expect(hasMinimumRole(UserRole.USER, UserRole.USER)).toBe(true);
    });

    it('should return false when user role is lower than required', () => {
      expect(hasMinimumRole(UserRole.USER, UserRole.ADMIN)).toBe(false);
      expect(hasMinimumRole(UserRole.SUPPORT, UserRole.MANAGER)).toBe(false);
    });
  });

  describe('canManageLevel (non-strict, reads)', () => {
    it('should allow a higher level to reach a lower one', () => {
      expect(canManageLevel(ADMIN, CUSTOM_ROLE_LEVEL)).toBe(true);
    });

    it('should allow peers to see each other', () => {
      expect(canManageLevel(actorAt(3), 3)).toBe(true);
    });

    it('should refuse a lower level', () => {
      expect(canManageLevel(actorAt(2), 3)).toBe(false);
    });

    it('should reserve stranded roles for the admin role, not its level', () => {
      expect(canManageLevel(actorAt(3), UNKNOWN_ROLE_LEVEL)).toBe(false);
      expect(canManageLevel(actorAt(6), UNKNOWN_ROLE_LEVEL)).toBe(false);
      expect(canManageLevel(ADMIN, UNKNOWN_ROLE_LEVEL)).toBe(true);
    });
  });

  describe('canModifyLevel (strict, mutations)', () => {
    it('should allow a higher level to act on a lower one', () => {
      expect(canModifyLevel(ADMIN, 3)).toBe(true);
      expect(canModifyLevel(actorAt(3), CUSTOM_ROLE_LEVEL)).toBe(true);
    });

    it('should refuse peers', () => {
      expect(canModifyLevel(actorAt(3), 3)).toBe(false);
      expect(canModifyLevel(ADMIN, 4)).toBe(false);
    });

    it('should refuse a lower level', () => {
      expect(canModifyLevel(actorAt(1), 4)).toBe(false);
    });

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

    it('places the default host roles between user and admin, as before', () => {
      expect(ROLE_HIERARCHY).toEqual({
        user: 1,
        support: 2,
        manager: 3,
        admin: 4,
      });
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

    it.each([
      'editor',
      'content-editor',
      'tier-2',
      'User',
      ' user ',
      'a--b',
      'a b',
      'é',
      '',
    ])(
      'calls %p canonical exactly when the slug normaliser keeps it',
      (slug) => {
        expect(isCanonicalRoleSlug(slug)).toBe(
          slug !== '' && generateSlug(slug) === slug,
        );
      },
    );
  });

  describe('isValidRoleAssignment', () => {
    it('should return true for non-ADMIN roles', () => {
      expect(isValidRoleAssignment(UserRole.USER)).toBe(true);
      expect(isValidRoleAssignment(UserRole.SUPPORT)).toBe(true);
      expect(isValidRoleAssignment(UserRole.MANAGER)).toBe(true);
      expect(isValidRoleAssignment('content-editor')).toBe(true);
    });

    it('should return false for ADMIN role', () => {
      expect(isValidRoleAssignment(UserRole.ADMIN)).toBe(false);
    });
  });
});
