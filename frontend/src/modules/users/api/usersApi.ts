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
      query: (data) => ({
        url: '/api/admin/users',
        method: 'POST',
        body: data,
      }),
      transformResponse: (response: {
        success: boolean;
        data: Omit<AdminUser, '_id'> & { id: string };
        message: string;
      }) => {
        const { id, ...rest } = response.data;
        return { ...rest, _id: id };
      },
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
      query: ({ userId, name, email }) => ({
        url: `/api/admin/users/${userId}`,
        method: 'PATCH',
        body: { ...(name === undefined ? {} : { name }), email },
      }),
      transformResponse: (response: {
        success: boolean;
        data: Omit<AdminUser, '_id'> & { id: string };
        message: string;
      }) => {
        const { id, ...rest } = response.data;
        return { ...rest, _id: id };
      },
      invalidatesTags: invalidateOnSuccess(({ userId }: UpdateUserRequest) => [
        { type: 'User', id: userId },
        { type: 'User', id: 'LIST' },
      ]),
    }),

    resendEmailChange: builder.mutation<MessageResult, string>({
      query: (userId) => ({
        url: `/api/admin/users/${userId}/resend-email-change`,
        method: 'POST',
      }),
      transformResponse: (response: unknown) => unwrapObjectBody<MessageResult>(response),
    }),

    /**
     * Update user status (admin)
     */
    updateUserStatus: builder.mutation<
      { id: string; isDeleted: boolean; deletedAt?: string },
      UpdateUserStatusRequest
    >({
      query: ({ userId, isActive }) => ({
        url: `/api/admin/users/${userId}/status`,
        method: 'PATCH',
        body: { isActive },
      }),
      transformResponse: (response: {
        success: boolean;
        data: { id: string; isDeleted: boolean; deletedAt?: string };
        message: string;
      }) => response.data,
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
    updateUserRole: builder.mutation<{ id: string; role: string }, UpdateUserRoleRequest>({
      query: ({ userId, role }) => ({
        url: `/api/admin/users/${userId}/role`,
        method: 'PATCH',
        body: { role },
      }),
      transformResponse: (response: {
        success: boolean;
        data: { id: string; role: string };
        message: string;
      }) => response.data,
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
    deleteUser: builder.mutation<void, string>({
      query: (userId) => ({
        url: `/api/admin/users/${userId}`,
        method: 'DELETE',
      }),
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome((userId: string) => [
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
