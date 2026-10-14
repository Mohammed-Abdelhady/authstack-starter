import { describe, expect, it } from 'vitest';
import { parsePermission } from './permission-utils';

describe('parsePermission', () => {
  it.each(['', 'users', ' '])('returns null without an action separator for %j', (permission) => {
    expect(parsePermission(permission)).toBeNull();
  });

  it.each([
    ['*', { resource: '*', action: '*', scope: undefined }],
    ['users:read', { resource: 'users', action: 'read', scope: undefined }],
    ['users:read:all', { resource: 'users', action: 'read', scope: 'all' }],
    [':', { resource: '', action: '', scope: undefined }],
    ['users:', { resource: 'users', action: '', scope: undefined }],
    ['users:read:', { resource: 'users', action: 'read', scope: '' }],
    ['users:read:all:extra', { resource: 'users', action: 'read', scope: 'all' }],
  ])('preserves the components and scope key of %j', (permission, expected) => {
    expect(parsePermission(permission)).toStrictEqual(expected);
  });
});
