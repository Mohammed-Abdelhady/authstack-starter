import { staffRequest } from '@/modules/auth/api/staffRequest';
import { IDEMPOTENCY_HEADER } from '@/modules/auth/constants/staff-operation';
import { API_PATHS, unwrapObjectBody } from '@app/sdk';
import { baseApi } from '@/store/api/baseApi';
import {
  invalidateOnSuccess,
  invalidateOnSuccessOrUnknownOutcome,
} from '@/store/api/invalidateOnSuccess';
import { ROLE_LIST_MAX_PAGE_SIZE, ROLE_LIST_MAX_PAGES, ROLE_LIST_TOO_LONG } from '../constants';
import type {
  Role,
  CreateRoleRequest,
  UpdateRoleRequest,
  ListRolesQuery,
  ListRolesResponse,
} from '../types';

/** Argument of the update-role mutation: which role and what to change. */
interface CreateRoleArgs {
  data: CreateRoleRequest;
  idempotencyKey: string;
}

interface DeleteRoleArgs {
  idOrSlug: string;
  version: number;
}

export interface UpdateRoleArgs {
  idOrSlug: string;
  data: UpdateRoleRequest;
}

/** A page of the roles list as the server sends it. */
interface RoleListBody {
  data: { roles: Role[]; total: number; pages?: number };
}

/**
 * Roles API slice with role management endpoints
 */
export const rolesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Get all roles with pagination
     */
    listRoles: builder.query<ListRolesResponse, ListRolesQuery | undefined>({
      query: (params = {}) => ({
        url: API_PATHS.admin.roles,
        params,
      }),
      transformResponse: (response: {
        success: boolean;
        data: {
          roles: Role[];
          total: number;
          page: number;
          pages?: number;
          totalPages?: number;
          limit?: number;
        };
      }): ListRolesResponse => {
        const raw = response.data;
        const limit = raw.limit ?? 20;
        const totalPages =
          raw.totalPages ?? raw.pages ?? Math.max(1, Math.ceil((raw.total || 0) / limit));
        return {
          roles: raw.roles,
          total: raw.total,
          page: raw.page,
          limit,
          totalPages,
        };
      },
      providesTags: ['Roles'],
    }),

    /**
     * Every role, read a page at a time until the last one. The server has no
     * route for the whole list and caps a page, so a selector that needs them
     * all asks here. A failed page fails the whole read.
     */
    listAllRoles: builder.query<Role[], void>({
      async queryFn(...[, , , fetchPage]) {
        const roles = new Map<string, Role>();
        for (let page = 1; page <= ROLE_LIST_MAX_PAGES; page += 1) {
          const result = await fetchPage({
            url: API_PATHS.admin.roles,
            params: { page, limit: ROLE_LIST_MAX_PAGE_SIZE },
          });
          if (result.error) return { error: result.error };
          const { roles: pageRoles, pages, total } = (result.data as RoleListBody).data;
          for (const role of pageRoles) roles.set(role.id, role);
          const lastPage = pages ?? Math.ceil(total / ROLE_LIST_MAX_PAGE_SIZE);
          if (page >= lastPage) return { data: [...roles.values()] };
        }
        return { error: { status: 'CUSTOM_ERROR', error: ROLE_LIST_TOO_LONG } };
      },
      providesTags: ['Roles'],
    }),

    /**
     * Get single role by ID or slug
     */
    getRole: builder.query<Role, string>({
      query: (idOrSlug) => API_PATHS.admin.role(idOrSlug),
      transformResponse: (response: { success: boolean; data: Role }) => response.data,
      providesTags: (result, error, idOrSlug) => [{ type: 'Roles', id: idOrSlug }],
    }),

    /**
     * Create new role
     */
    createRole: builder.mutation<Role, CreateRoleArgs>({
      queryFn: (...[{ data, idempotencyKey }, , , fetch]) =>
        staffRequest<Role>(
          {
            url: API_PATHS.admin.roles,
            method: 'POST',
            body: data,
            headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
          },
          fetch,
          unwrapObjectBody<Role>,
        ),
      invalidatesTags: invalidateOnSuccess(['Roles']),
    }),

    /**
     * Update existing role
     */
    updateRole: builder.mutation<Role, UpdateRoleArgs>({
      queryFn: (...[{ idOrSlug, data }, , , fetch]) =>
        staffRequest<Role>(
          {
            url: API_PATHS.admin.role(idOrSlug),
            method: 'PATCH',
            body: data,
          },
          fetch,
          unwrapObjectBody<Role>,
        ),
      // A rename moves every holder to the new slug, and a change of
      // permissions changes what every holder inherits.
      invalidatesTags: invalidateOnSuccessOrUnknownOutcome(({ idOrSlug }: UpdateRoleArgs) => [
        'Roles',
        { type: 'Roles', id: idOrSlug },
        'User',
        'Permissions',
      ]),
    }),

    /**
     * Delete role
     */
    deleteRole: builder.mutation<null, DeleteRoleArgs>({
      queryFn: async (...[{ idOrSlug, version }, , , fetch]) => {
        const result = await staffRequest(
          {
            url: API_PATHS.admin.role(idOrSlug),
            method: 'DELETE',
            params: { version },
          },
          fetch,
          () => ({}),
        );
        return result.error ? { error: result.error } : { data: null };
      },
      invalidatesTags: invalidateOnSuccess(['Roles']),
    }),
  }),
});

export const {
  useListRolesQuery,
  useListAllRolesQuery,
  useGetRoleQuery,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
} = rolesApi;
