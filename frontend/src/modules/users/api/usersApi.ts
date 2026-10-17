import { staffRequest } from '@/modules/auth/api/staffRequest';
import { IDEMPOTENCY_HEADER } from '@/modules/auth/constants/staff-operation';
import { baseApi } from '@/store/api/baseApi';
import { unwrapObjectBody, type MessageResult } from '@app/sdk';
import {
  invalidateOnSuccess,
  invalidateOnSuccessOrUnknownOutcome,
} from '@/store/api/invalidateOnSuccess';
import type {
  AdminUser,
  GetUsersParams,
  GetUsersResponse,
  CreateUserRequest,
  DeleteUserRequest,
  ResendEmailChangeRequest,
  UpdateUserRequest,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
} from '../types';

/**
 * API response structure from backend
 */
interface ApiUsersResponse {
  data: Array<Omit<AdminUser, '_id'> & { id: string }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Users API slice for managing users (admin)
 */
export const usersApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Get all users (admin)
     */
    getUsers: builder.query<GetUsersResponse, GetUsersParams>({
      query: (params) => {
        const searchParams = new URLSearchParams();
        if (params.page) searchParams.append('page', params.page.toString());
        if (params.limit) searchParams.append('limit', params.limit.toString());
        if (params.search) searchParams.append('search', params.search);
        if (params.role) searchParams.append('role', params.role);
        if (params.isVerified !== undefined)
          searchParams.append('isVerified', params.isVerified.toString());

        const queryString = searchParams.toString();
        return `/api/admin/users${queryString ? `?${queryString}` : ''}`;
      },
      transformResponse: (response: { success: boolean; data: ApiUsersResponse }) => {
        const { data, pagination } = response.data;
        const totalPages =
          pagination.totalPages ??
          Math.max(1, Math.ceil(pagination.total / (pagination.limit || 20)));
        return {
          users: data.map((user) => ({
            ...user,
            _id: user.id,
          })),
          total: pagination.total,
          page: pagination.page,
          limit: pagination.limit,
          totalPages,
        };
      },
      providesTags: (result) =>
        result && result.users
          ? [
              ...result.users.map(({ _id }) => ({ type: 'User' as const, id: _id })),
              { type: 'User', id: 'LIST' },
            ]
          : [{ type: 'User', id: 'LIST' }],
    }),

    /**
     * Create new user (admin)
     */
    createUser: builder.mutation<AdminUser, CreateUserRequest>({
      queryFn: (...[{ body, idempotencyKey }, , , fetch]) =>
        staffRequest(
          {
            url: '/api/admin/users',
            method: 'POST',
            body,
            headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
          },
          fetch,
          (response) => {
            const { id, ...rest } = unwrapObjectBody<Omit<AdminUser, '_id'> & { id: string }>(
              response,
            );
            return { ...rest, _id: id };
          },
        ),
      invalidatesTags: invalidateOnSuccess([{ type: 'User', id: 'LIST' }]),
    }),

    /**
     * Get user by ID (admin)
     */
    getUserById: builder.query<AdminUser, string>({
      query: (userId) => `/api/admin/users/${userId}`,
      transformResponse: (response: {
        success: boolean;
        data: Omit<AdminUser, '_id'> & { id: string };
      }) => {
        const { id, ...rest } = response.data;
        return { ...rest, _id: id };
      },
      providesTags: (result, error, userId) => [{ type: 'User', id: userId }],
    }),

    /**
     * Update user information (admin)
     */
    updateUser: builder.mutation<AdminUser, UpdateUserRequest>({
      queryFn: (...[{ userId, name, email, version }, , , fetch]) =>
        staffRequest(
          {
            url: `/api/admin/users/${userId}`,
            method: 'PATCH',
            body: { ...(name === undefined ? {} : { name }), email, version },
          },
          fetch,
          (response) => {
            const { id, ...rest } = unwrapObjectBody<Omit<AdminUser, '_id'> & { id: string }>(
              response,
            );
            return { ...rest, _id: id };
          },
        ),
      invalidatesTags: invalidateOnSuccess(({ userId }: UpdateUserRequest) => [
        { type: 'User', id: userId },
        { type: 'User', id: 'LIST' },
      ]),
    }),

    resendEmailChange: builder.mutation<MessageResult, ResendEmailChangeRequest>({
      queryFn: (...[{ userId, version }, , , fetch]) =>
        staffRequest<MessageResult>(
          {
            url: `/api/admin/users/${userId}/resend-email-change`,
            method: 'POST',
            body: { version },
          },
          fetch,
          unwrapObjectBody<MessageResult>,
        ),
    }),

    /**
     * Update user status (admin)
     */
    updateUserStatus: builder.mutation<
      { id: string; isDeleted: boolean; deletedAt?: string; version: number },
      UpdateUserStatusRequest
    >({
      queryFn: (...[{ userId, isActive, version }, , , fetch]) =>
        staffRequest<{ id: string; isDeleted: boolean; deletedAt?: string; version: number }>(
          {
            url: `/api/admin/users/${userId}/status`,
            method: 'PATCH',
            body: { isActive, version },
          },
          fetch,
        ),
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(
        ({ userId }: UpdateUserStatusRequest) => [
          { type: 'User', id: userId },
          { type: 'User', id: 'LIST' },
        ],
      ),
    }),

    /**
     * Update user role (admin)
     */
    updateUserRole: builder.mutation<
      { id: string; role: string; version: number },
      UpdateUserRoleRequest
    >({
      queryFn: (...[{ userId, role, version }, , , fetch]) =>
        staffRequest<{ id: string; role: string; version: number }>(
          { url: `/api/admin/users/${userId}/role`, method: 'PATCH', body: { role, version } },
          fetch,
        ),
      // The permissions read of a user carries the role and what it grants.
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(({ userId }: UpdateUserRoleRequest) => [
        { type: 'User', id: userId },
        { type: 'User', id: 'LIST' },
        { type: 'Permissions', id: userId },
      ]),
    }),

    /**
     * Delete user (admin)
     */
    deleteUser: builder.mutation<null, DeleteUserRequest>({
      queryFn: async (...[{ userId, version }, , , fetch]) => {
        const result = await staffRequest(
          { url: `/api/admin/users/${userId}`, method: 'DELETE', params: { version } },
          fetch,
          () => ({}),
        );
        return result.error ? { error: result.error } : { data: null };
      },
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(({ userId }: DeleteUserRequest) => [
        { type: 'User', id: userId },
        { type: 'User', id: 'LIST' },
      ]),
    }),
  }),
});

export const {
  useGetUsersQuery,
  useGetUserByIdQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useResendEmailChangeMutation,
  useUpdateUserStatusMutation,
  useUpdateUserRoleMutation,
  useDeleteUserMutation,
} = usersApi;
