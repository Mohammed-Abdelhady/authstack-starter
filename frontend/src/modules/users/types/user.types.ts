/**
 * User interface for admin user management
 */
export interface AdminUser {
  _id: string;
  email: string;
  name: string;
  role: string;
  isVerified: boolean;
  isDeleted: boolean;
  /** New address awaiting confirmation, absent or null when none is pending. */
  pendingEmail?: string | null;
  /** 'email' or an OAuth provider id from the backend registry. */
  authProvider: string;
  linkedProviders: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Get users query params
 */
export interface GetUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  isVerified?: boolean;
}

/**
 * Get users response
 */
export interface GetUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Create user request
 */
export interface CreateUserRequest {
  email: string;
  name: string;
  password: string;
  role: string;
}

/**
 * Update user role request
 */
export interface UpdateUserRoleRequest {
  userId: string;
  role: string;
}

/**
 * Update user status request
 */
export interface UpdateUserStatusRequest {
  userId: string;
  isActive: boolean;
}

/**
 * Update user request
 */
export interface UpdateUserRequest {
  userId: string;
  /** Absent when the admin only changed the email. */
  name?: string;
  email: string;
}
