import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@app/core';
import { PERMISSION_GROUPS, buildPermissionGroups } from '../permissionGroups';

const outline = (groups: ReturnType<typeof buildPermissionGroups>) =>
  groups.map(({ id, hasCatalogName, permissions }) => ({
    id,
    hasCatalogName,
    permissions: Object.values(permissions),
  }));

const CORE_OUTLINE = [
  {
    id: 'profile',
    hasCatalogName: true,
    permissions: ['profile:read:own', 'profile:update:own', 'profile:delete:own'],
  },
  {
    id: 'users',
    hasCatalogName: true,
    permissions: [
      'users:read:all',
      'users:list:all',
      'users:create:all',
      'users:update:all',
      'users:delete:all',
      'users:update:own',
    ],
  },
  {
    id: 'roles',
    hasCatalogName: true,
    permissions: [
      'roles:read:all',
      'roles:list:all',
      'roles:create:all',
      'roles:update:all',
      'roles:delete:all',
      'roles:manage:all',
    ],
  },
  {
    id: 'permissions',
    hasCatalogName: true,
    permissions: [
      'permissions:read:all',
      'permissions:grant:all',
      'permissions:revoke:all',
      'permissions:manage:all',
    ],
  },
  {
    id: 'sessions',
    hasCatalogName: true,
    permissions: [
      'sessions:read:all',
      'sessions:read:own',
      'sessions:delete:all',
      'sessions:delete:own',
    ],
  },
  {
    id: 'reports',
    hasCatalogName: true,
    permissions: ['reports:read:all', 'reports:create:all'],
  },
];

describe('permission groups built from the resource of each permission', () => {
  it('keeps the core groups, their order and their permissions with the default host list', () => {
    expect(outline(PERMISSION_GROUPS)).toEqual(CORE_OUTLINE);
  });

  it('appends a host resource as its own group, with no catalogue name', () => {
    const groups = buildPermissionGroups(ALL_PERMISSIONS, ['orders:refund:all', 'orders:read:own']);

    expect(outline(groups).slice(-2)).toEqual([
      CORE_OUTLINE[5],
      {
        id: 'orders',
        hasCatalogName: false,
        permissions: ['orders:refund:all', 'orders:read:own'],
      },
    ]);
  });

  it('puts a host permission on a core resource into that core group', () => {
    const users = buildPermissionGroups(['users:read:all'], ['users:export:all']);

    expect(outline(users)).toEqual([
      {
        id: 'users',
        hasCatalogName: true,
        permissions: ['users:read:all', 'users:export:all'],
      },
    ]);
  });

  it('leaves out the wildcard, a string with no action and a repeat', () => {
    expect(outline(buildPermissionGroups(['*'], ['orders', 'orders:read', 'orders:read']))).toEqual(
      [{ id: 'orders', hasCatalogName: false, permissions: ['orders:read'] }],
    );
  });
});
