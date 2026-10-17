import { staffRequest } from '@/modules/auth/api/staffRequest';
import {
  API_PATHS,
  unwrapAdminPermissionListBody,
  unwrapAdminPermissionResultBody,
} from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import { invalidateOnSuccess } from '@/store/api/invalidateOnSuccess';

/**
 * User permissions response
 */
export interface UserPermissionsResponse {
  version?: number;
  userId: string;
  permissions: string[];
  role: string;
}

interface UserPermissionResult {
  userId: string;
  permissions: string[];
  version?: number;
}

/** Argument of the add and remove permission mutations. */
export interface UserPermissionArgs {
  version: number;
  userId: string;
  permission: string;
}

/**
 * Add permission request
 */
export interface AddPermissionRequest {
  permission: string;
}

/**
 * Permissions API slice for managing user permissions
 */
export const permissionsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Get user permissions
     */
    getUserPermissions: builder.query<UserPermissionsResponse, string>({
      query: (userId) => API_PATHS.admin.permissions(userId),
      transformResponse: unwrapAdminPermissionListBody,
      providesTags: (result, error, userId) => [{ type: 'Permissions', id: userId }],
    }),

    /**
     * Add permission to user
     */
    addPermission: builder.mutation<UserPermissionResult, UserPermissionArgs>({
      queryFn: (...[{ userId, permission, version }, , , fetch]) =>
        staffRequest(
          {
            url: API_PATHS.admin.permissions(userId),
            method: 'POST',
            body: { permission, version },
          },
          fetch,
          unwrapAdminPermissionResultBody,
        ),
      invalidatesTags: invalidateOnSuccess(({ userId }: UserPermissionArgs) => [
        { type: 'Permissions', id: userId },
        'User',
      ]),
    }),

    /**
     * Remove permission from user
     */
    removePermission: builder.mutation<UserPermissionResult, UserPermissionArgs>({
      queryFn: (...[{ userId, permission, version }, , , fetch]) =>
        staffRequest(
          {
            url: API_PATHS.admin.permission(userId, permission),
            method: 'DELETE',
            params: { version },
          },
          fetch,
          unwrapAdminPermissionResultBody,
        ),
      invalidatesTags: invalidateOnSuccess(({ userId }: UserPermissionArgs) => [
        { type: 'Permissions', id: userId },
        'User',
      ]),
    }),
  }),
});

// Export hooks
export const { useGetUserPermissionsQuery, useAddPermissionMutation, useRemovePermissionMutation } =
  permissionsApi;
