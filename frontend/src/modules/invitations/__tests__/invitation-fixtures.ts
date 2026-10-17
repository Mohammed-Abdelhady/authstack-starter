import { USER_PERMISSIONS } from '@app/core';

export const ACTOR = {
  locale: 'en',
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Administrator',
  role: 'admin',
  permissions: [
    USER_PERMISSIONS.LIST_ALL,
    USER_PERMISSIONS.CREATE_ALL,
    USER_PERMISSIONS.CREATE_STAFF,
  ],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: [],
};
export const ROLE = {
  id: 'role-1',
  name: 'Member',
  slug: 'user',
  level: 1,
  permissions: [],
  isSystemRole: false,
  isProtected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
export const INVITATION = {
  id: 'invitation-1',
  email: 'invitee@example.com',
  role: 'user',
  status: 'pending',
  expiresAt: '2026-12-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
};
