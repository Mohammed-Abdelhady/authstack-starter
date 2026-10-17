import { authApi } from '@/modules/auth/store/authApi';
import { sessionsApi } from '@/modules/sessions/api/sessionsApi';
import { usersApi } from '@/modules/users/api/usersApi';
import { rolesApi } from '@/modules/roles/api/rolesApi';
import { permissionsApi } from '@/modules/permissions/api/permissionsApi';
import type { MutationCase } from './mutationSweepBase';
import {
  ADMIN_USER,
  GET_PERMISSIONS,
  GET_PROFILE,
  GET_ROLE,
  GET_ROLES,
  GET_SESSIONS,
  GET_USER,
  GET_USERS,
  PERMISSIONS,
  PROFILE,
  ROLE,
  readPermissions,
  readProfile,
  readRole,
  readRoles,
  readSessions,
  readUser,
  readUsers,
} from './mutationSweepBase';

/**
 * Every mutation of the core slices that does not invalidate on a 4xx: the
 * refused write issues no read, the accepted write repeats exactly the reads
 * its tags invalidated. Mutations whose server keeps part of the write set
 * `outcomeUnknown`, so their reads also repeat on a 5xx or a lost answer.
 */
export const CONVERTED: MutationCase[] = [
  {
    name: 'login',
    reads: [readProfile],
    write: (store) =>
      store.dispatch(
        authApi.endpoints.login.initiate({ email: 'omar@example.com', password: 'Passw0rd!Omar' }),
      ),
    accepted: { requiresTwoFactor: false, user: PROFILE },
    requests: [GET_PROFILE, 'POST /api/auth/login'],
    refetched: [GET_PROFILE],
  },
  {
    name: 'activate',
    reads: [readProfile],
    write: (store) =>
      store.dispatch(
        authApi.endpoints.activate.initiate({
          email: 'omar@example.com',
          code: '123456',
          name: 'Omar Nasser',
          password: 'Passw0rdOmar',
        }),
      ),
    accepted: { requiresTwoFactor: false, user: PROFILE },
    requests: [GET_PROFILE, 'POST /api/auth/activate'],
    refetched: [GET_PROFILE],
  },
  {
    name: 'changePassword',
    reads: [readProfile, readSessions],
    write: (store) =>
      store.dispatch(
        authApi.endpoints.changePassword.initiate({
          currentPassword: 'OldPassw0rdLayla',
          newPassword: 'NewPassw0rdLayla',
        }),
      ),
    accepted: { message: 'Password changed' },
    requests: [GET_PROFILE, GET_SESSIONS, 'POST /api/user/password'],
    refetched: [GET_SESSIONS],
  },
  {
    name: 'updateProfile',
    reads: [readProfile],
    write: (store) => store.dispatch(authApi.endpoints.updateProfile.initiate({ name: 'Layla H' })),
    accepted: PROFILE,
    requests: [GET_PROFILE, 'PATCH /api/user/profile'],
    refetched: [GET_PROFILE],
  },
  {
    name: 'createRole',
    reads: [readRoles],
    write: (store) =>
      store.dispatch(
        rolesApi.endpoints.createRole.initiate({
          data: { name: 'Editor', permissions: ['users.write'] },
          idempotencyKey: 'cache-role-create-operation',
        }),
      ),
    accepted: ROLE,
    requests: [GET_ROLES, 'POST /api/roles'],
    refetched: [GET_ROLES],
  },
  {
    name: 'updateRole',
    reads: [readRoles, readRole, readUsers, readUser, readPermissions],
    write: (store) =>
      store.dispatch(
        rolesApi.endpoints.updateRole.initiate({
          idOrSlug: 'editor',
          data: { version: 0, name: 'Editor' },
        }),
      ),
    accepted: ROLE,
    // The server saves the rename first and moves users second: a failure
    // there answers an error against a role that is already renamed.
    outcomeUnknown: true,
    requests: [
      GET_ROLES,
      GET_ROLE,
      GET_USERS,
      GET_USER,
      GET_PERMISSIONS,
      'PATCH /api/roles/editor',
    ],
    // Holders move to the new slug and inherit the new permissions, so the
    // user lists and the permissions of a user are read again with the roles.
    refetched: [GET_ROLES, GET_ROLE, GET_USERS, GET_USER, GET_PERMISSIONS],
  },
  {
    name: 'deleteRole',
    reads: [readRoles],
    write: (store) =>
      store.dispatch(rolesApi.endpoints.deleteRole.initiate({ idOrSlug: 'editor', version: 0 })),
    accepted: { message: 'Role deleted' },
    requests: [GET_ROLES, 'DELETE /api/roles/editor'],
    refetched: [GET_ROLES],
  },
  {
    name: 'addPermission',
    reads: [readProfile, readPermissions],
    write: (store) =>
      store.dispatch(
        permissionsApi.endpoints.addPermission.initiate({
          version: 0,
          userId: 'user-2',
          permission: 'users.write',
        }),
      ),
    accepted: PERMISSIONS,
    requests: [GET_PROFILE, GET_PERMISSIONS, 'POST /api/admin/users/user-2/permissions'],
    refetched: [GET_PERMISSIONS, GET_PROFILE],
  },
  {
    name: 'removePermission',
    reads: [readProfile, readPermissions],
    write: (store) =>
      store.dispatch(
        permissionsApi.endpoints.removePermission.initiate({
          version: 0,
          userId: 'user-2',
          permission: 'users.write',
        }),
      ),
    accepted: PERMISSIONS,
    requests: [
      GET_PROFILE,
      GET_PERMISSIONS,
      'DELETE /api/admin/users/user-2/permissions/users.write',
    ],
    refetched: [GET_PERMISSIONS, GET_PROFILE],
  },
  {
    name: 'createUser',
    reads: [readProfile, readUsers],
    write: (store) =>
      store.dispatch(
        usersApi.endpoints.createUser.initiate({
          body: {
            email: 'omar@example.com',
            name: 'Omar Nasser',
            password: 'Passw0rd!Omar',
            role: 'user',
          },
          idempotencyKey: 'cache-user-create-operation',
        }),
      ),
    accepted: ADMIN_USER,
    requests: [GET_PROFILE, GET_USERS, 'POST /api/admin/users'],
    refetched: [GET_USERS],
  },
  {
    name: 'updateUser',
    reads: [readProfile, readUsers, readUser],
    write: (store) =>
      store.dispatch(
        usersApi.endpoints.updateUser.initiate({
          version: 0,
          userId: 'user-2',
          name: 'Omar N',
          email: 'omar@example.com',
        }),
      ),
    accepted: ADMIN_USER,
    requests: [GET_PROFILE, GET_USERS, GET_USER, 'PATCH /api/admin/users/user-2'],
    refetched: [GET_USERS, GET_USER],
  },
  {
    name: 'updateUserStatus',
    reads: [readUsers, readUser],
    write: (store) =>
      store.dispatch(
        usersApi.endpoints.updateUserStatus.initiate({
          version: 0,
          userId: 'user-2',
          isActive: false,
        }),
      ),
    accepted: { version: 1, id: 'user-2', isDeleted: true, deletedAt: '2026-10-02T00:00:00.000Z' },
    // The server saves the status first and revokes the sessions second: a
    // failed revocation answers 503 against an account already deactivated.
    outcomeUnknown: true,
    requests: [GET_USERS, GET_USER, 'PATCH /api/admin/users/user-2/status'],
    refetched: [GET_USERS, GET_USER],
  },
  {
    name: 'updateUserRole',
    reads: [readUsers, readUser, readPermissions],
    write: (store) =>
      store.dispatch(
        usersApi.endpoints.updateUserRole.initiate({ version: 0, userId: 'user-2', role: 'admin' }),
      ),
    accepted: ADMIN_USER,
    // Same server shape: the role is saved, then sessions are revoked.
    outcomeUnknown: true,
    requests: [GET_USERS, GET_USER, GET_PERMISSIONS, 'PATCH /api/admin/users/user-2/role'],
    // The permissions read carries the role and what it grants.
    refetched: [GET_USERS, GET_USER, GET_PERMISSIONS],
  },
  {
    name: 'deleteUser',
    reads: [readUsers, readUser],
    write: (store) =>
      store.dispatch(usersApi.endpoints.deleteUser.initiate({ userId: 'user-2', version: 0 })),
    accepted: { message: 'User deleted' },
    // Same server shape: the delete saves first, the revocation can answer 503
    // after the account is already gone (a retry answers "already deleted").
    outcomeUnknown: true,
    requests: [GET_USERS, GET_USER, 'DELETE /api/admin/users/user-2'],
    refetched: [GET_USERS, GET_USER],
  },
];

/**
 * Sign-out repeats its reads only when the server answered and refused it:
 * the session may or may not be gone, so the server is asked. `refetched`
 * lists those reads. A confirmed sign-out repeats nothing, and neither does
 * one sent to a server that could not be reached.
 */
export const SIGN_OUT: MutationCase = {
  name: 'logout',
  reads: [readProfile],
  write: (store) => store.dispatch(authApi.endpoints.logout.initiate()),
  accepted: { message: 'Signed out' },
  requests: [GET_PROFILE, 'POST /api/auth/logout'],
  refetched: [GET_PROFILE],
};

/**
 * Mutations that must keep invalidating even when the request is rejected.
 * Revoking a listed session: a 404 "already revoked" answers after the server
 * did revoke, and an answer can be lost in flight, so the reads repeat on a
 * 400 refusal and on anything else.
 */
export const SESSION_REVOCATIONS: MutationCase[] = [
  {
    name: 'deleteSession',
    reads: [readSessions],
    write: (store) => store.dispatch(sessionsApi.endpoints.deleteSession.initiate('session-2')),
    accepted: { message: 'Session revoked' },
    requests: [GET_SESSIONS, 'DELETE /api/user/sessions/session-2'],
    refetched: [GET_SESSIONS],
  },
  {
    name: 'revokeAllOtherSessions',
    reads: [readSessions],
    write: (store) => store.dispatch(sessionsApi.endpoints.revokeAllOtherSessions.initiate()),
    accepted: { revokedCount: 2 },
    requests: [GET_SESSIONS, 'POST /api/user/sessions/revoke-others'],
    refetched: [GET_SESSIONS],
  },
];

/** Every mutation that invalidates on a rejection, for the coverage guards. */
export const EXCEPTIONS: MutationCase[] = [SIGN_OUT, ...SESSION_REVOCATIONS];
