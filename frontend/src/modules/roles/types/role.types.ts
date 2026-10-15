import type { RoleAudience } from '@app/core';

/**
 * Role data structure
 */
export interface Role {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isSystemRole: boolean;
  isProtected: boolean;
  /** Hierarchy level. A person can assign only roles below the level of their own. */
  level: number;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Create role request payload
 */
export interface CreateRoleRequest {
  audience?: RoleAudience;
  name: string;
  description?: string;
  permissions: string[];
}

/**
 * Update role request payload
 */
export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  permissions?: string[];
}

/**
 * List roles query parameters
 */
export interface ListRolesQuery {
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * List roles response
 */
export interface ListRolesResponse {
  roles: Role[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
