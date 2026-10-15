import { SESSION_PERMISSIONS } from '@app/core';
import { unwrapObjectBody } from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import type { RootState } from '@/store/store';
import type {
  AdminSessionList,
  AdminSessionScope,
  EndAdminSession,
} from '../types/admin-session.types';
import { sessionScopeIsCurrent } from '../utils/sessionScopeIsCurrent';

function sessionsUrl(userId: string): string {
  return `/api/admin/users/${encodeURIComponent(userId)}/sessions`;
}

function tag(scope: AdminSessionScope) {
  return {
    type: 'Sessions' as const,
    id: `admin:${scope.actorId}:${scope.sessionGeneration}:${scope.userId}`,
  };
}

const STALE_REQUEST = { error: { status: 403, data: {} } } as const;
const UNKNOWN_WRITE = {
  error: { status: 'CUSTOM_ERROR', error: 'UNKNOWN_WRITE_OUTCOME' },
} as const;

export const adminSessionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminSessions: builder.query<AdminSessionList, AdminSessionScope>({
      async queryFn(scope, api, extra, baseQuery) {
        if (
          !sessionScopeIsCurrent(api.getState() as RootState, scope, SESSION_PERMISSIONS.READ_ALL)
        ) {
          return STALE_REQUEST;
        }
        const result = await baseQuery(sessionsUrl(scope.userId));
        if (
          !sessionScopeIsCurrent(api.getState() as RootState, scope, SESSION_PERMISSIONS.READ_ALL)
        ) {
          return STALE_REQUEST;
        }
        if (result.error) return { error: result.error };
        return { data: unwrapObjectBody<AdminSessionList>(result.data) };
      },
      providesTags: (result, error, scope) => [tag(scope)],
      keepUnusedDataFor: 0,
    }),
    endAdminSession: builder.mutation<{ revoked: boolean }, EndAdminSession>({
      async queryFn(scope, api, extra, baseQuery) {
        if (
          !sessionScopeIsCurrent(api.getState() as RootState, scope, SESSION_PERMISSIONS.DELETE_ALL)
        ) {
          return STALE_REQUEST;
        }
        const result = await baseQuery({
          url: `${sessionsUrl(scope.userId)}/${encodeURIComponent(scope.sessionId)}`,
          method: 'DELETE',
        });
        if (
          !sessionScopeIsCurrent(api.getState() as RootState, scope, SESSION_PERMISSIONS.DELETE_ALL)
        ) {
          return UNKNOWN_WRITE;
        }
        if (result.error) return { error: result.error };
        return { data: unwrapObjectBody<{ revoked: boolean }>(result.data) };
      },
      invalidatesTags: (result, error, scope) => [tag(scope)],
    }),
    endAllAdminSessions: builder.mutation<{ revokedCount: number }, AdminSessionScope>({
      async queryFn(scope, api, extra, baseQuery) {
        if (
          !sessionScopeIsCurrent(api.getState() as RootState, scope, SESSION_PERMISSIONS.DELETE_ALL)
        ) {
          return STALE_REQUEST;
        }
        const result = await baseQuery({
          url: `${sessionsUrl(scope.userId)}/revoke-all`,
          method: 'POST',
        });
        if (
          !sessionScopeIsCurrent(api.getState() as RootState, scope, SESSION_PERMISSIONS.DELETE_ALL)
        ) {
          return UNKNOWN_WRITE;
        }
        if (result.error) return { error: result.error };
        return { data: unwrapObjectBody<{ revokedCount: number }>(result.data) };
      },
      invalidatesTags: (result, error, scope) => [tag(scope)],
    }),
  }),
});

export const {
  useGetAdminSessionsQuery,
  useEndAdminSessionMutation,
  useEndAllAdminSessionsMutation,
} = adminSessionsApi;
