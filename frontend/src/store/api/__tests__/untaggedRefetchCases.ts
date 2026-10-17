import { authApi } from '@/modules/auth/store/authApi';
import { usersApi } from '@/modules/users/api/usersApi';
import type { MutationCase } from './mutationSweepBase';
import {
  GET_PERMISSIONS,
  GET_PROFILE,
  GET_ROLES,
  GET_SESSIONS,
  GET_USERS,
  readPermissions,
  readProfile,
  readRoles,
  readSessions,
  readUsers,
} from './mutationSweepBase';

/**
 * Core mutations that invalidate nothing: a refused write and an accepted one
 * both issue no read. Every case subscribes one read per tag type the core
 * sweeps touch — User, Sessions, Roles, Permissions — so a mutation that
 * gains any of those tags makes these rows fail. If one of them gains tags on
 * purpose, its case moves to `invalidationRefetchCases.ts`.
 */
const READ_SET = [readProfile, readSessions, readUsers, readRoles, readPermissions];

export const UNTAGGED: MutationCase[] = [
  {
    name: 'resendEmailChange',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(
        usersApi.endpoints.resendEmailChange.initiate({ userId: 'user-2', version: 0 }),
      ),
    accepted: { message: 'Confirmation sent' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/admin/users/user-2/resend-email-change',
    ],
    refetched: [],
  },
  {
    name: 'register',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(
        authApi.endpoints.register.initiate({
          email: 'omar@example.com',
        }),
      ),
    accepted: { email: 'omar@example.com' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/auth/register',
    ],
    refetched: [],
  },
  {
    name: 'confirmEmailChange',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(
        authApi.endpoints.confirmEmailChange.initiate({
          email: 'omar@example.com',
          code: '123456',
        }),
      ),
    accepted: { message: 'Confirmed' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/auth/confirm-email-change',
    ],
    refetched: [],
  },
  {
    name: 'resendActivation',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(authApi.endpoints.resendActivation.initiate({ email: 'omar@example.com' })),
    accepted: { message: 'Sent' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/auth/resend-activation',
    ],
    refetched: [],
  },
  {
    name: 'forgotPassword',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(authApi.endpoints.forgotPassword.initiate({ email: 'omar@example.com' })),
    accepted: { message: 'Sent' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/auth/forgot-password',
    ],
    refetched: [],
  },
  {
    name: 'resetPassword',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(
        authApi.endpoints.resetPassword.initiate({
          email: 'omar@example.com',
          code: 'reset-code',
          newPassword: 'NewPassw0rdOmar',
        }),
      ),
    accepted: { message: 'Password reset' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/auth/reset-password',
    ],
    refetched: [],
  },
  {
    name: 'approveNativeAuthorize',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(
        authApi.endpoints.approveNativeAuthorize.initiate({
          transactionId: 'txn-1',
          expectedUserId: 'user-1',
        }),
      ),
    accepted: { redirectUri: '/auth/callback?code=abc' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/oauth/authorize/approve',
    ],
    refetched: [],
  },
  {
    name: 'denyNativeAuthorize',
    reads: READ_SET,
    write: (store) =>
      store.dispatch(
        authApi.endpoints.denyNativeAuthorize.initiate({
          transactionId: 'txn-1',
          expectedUserId: 'user-1',
        }),
      ),
    accepted: { redirectUri: '/auth/callback?error=access_denied' },
    requests: [
      GET_PROFILE,
      GET_SESSIONS,
      GET_USERS,
      GET_ROLES,
      GET_PERMISSIONS,
      'POST /api/oauth/authorize/deny',
    ],
    refetched: [],
  },
];
