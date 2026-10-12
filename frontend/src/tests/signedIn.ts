import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { makeStore } from './serverRejectionHarness';

/**
 * The admin role as the roles list sends it. A selector reads the level of the
 * signed-in person's role from that list, so a list a test serves holds this
 * entry whenever an admin is the one looking at it.
 */
export const ADMIN_LISTED = {
  id: 'role-admin',
  slug: 'admin',
  name: 'Admin',
  level: 4,
  permissions: [],
  isSystemRole: true,
  isProtected: true,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

/** A store with a person signed in who holds `role`. */
export function storeSignedInAs(role: string, permissions: string[] = []) {
  const store = makeStore();
  store.dispatch(
    loginFulfilled({
      id: `actor-${role}`,
      email: `${role}@example.com`,
      name: 'Signed In',
      role,
      permissions,
    }),
  );
  return store;
}
