import { hasPermission } from '@app/core';
import { unwrapObjectBody } from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import type { RootState } from '@/store/store';
import { ACTIVITY_READ_PERMISSION } from '../constants/activity';
import type { ActivityPage, ActivityQuery } from '../types/activity.types';

function isCurrent(state: RootState, query: ActivityQuery): boolean {
  return (
    state.auth.isAuthenticated &&
    state.auth.user?.id === query.actorId &&
    state.auth.sessionGeneration === query.sessionGeneration &&
    hasPermission(state.auth.user.permissions, ACTIVITY_READ_PERMISSION)
  );
}

export const activityApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminActivity: builder.query<ActivityPage, ActivityQuery>({
      async queryFn(query, api, extra, baseQuery) {
        const stale = { error: { status: 403, data: {} } } as const;
        if (!isCurrent(api.getState() as RootState, query)) return stale;
        const params = new URLSearchParams({
          page: String(query.page),
          limit: String(query.limit),
        });
        for (const field of ['actor', 'action', 'target', 'from', 'to'] as const) {
          const value = query[field];
          if (value) params.set(field, value);
        }
        const result = await baseQuery(`/api/admin/activity?${params}`);
        if (!isCurrent(api.getState() as RootState, query)) return stale;
        if (result.error) return { error: result.error };
        return { data: unwrapObjectBody<ActivityPage>(result.data) };
      },
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useGetAdminActivityQuery } = activityApi;
