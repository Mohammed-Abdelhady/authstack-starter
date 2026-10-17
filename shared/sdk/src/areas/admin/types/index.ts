import type { CallOptions } from '../../../client';
import type { OperationHandle } from '../../../browser-transport/operations';
import type { TransportSignal } from '../../../transport';
// feature:invitations:start
import type {
  AdminInvitation,
  AdminInvitationPage,
  AdminInvitationQuery,
  CreateAdminInvitationRequest,
} from '../../../types/invitations';
// feature:invitations:end
import type { MessageResult, Session } from '../../../types';

export interface AdminCreateOptions<
  TSignal extends TransportSignal = TransportSignal,
> extends CallOptions<TSignal> {
  operation?: OperationHandle;
  createOperationKey?: () => string;
}

export interface AdminVersion {
  version?: number;
}

export interface AdminVersionOptions<TSignal extends TransportSignal = TransportSignal>
  extends CallOptions<TSignal>, AdminVersion {}

export interface AdminAccount {
  /** Latest recorded activity among retained sessions; null when no dated observation remains. */
  lastActiveAt: string | null;
  version: number;
  audience?: 'customer' | 'staff';
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  authProvider: string;
  isVerified: boolean;
  isDeleted: boolean;
  linkedProviders: string[];
  pendingEmail?: string;
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminAccountQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  status?: 'active' | 'inactive' | 'deleted';
  isVerified?: boolean;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'email';
  sortOrder?: 'asc' | 'desc';
}

export interface AdminAccountList {
  data: AdminAccount[];
  pagination: AdminPagination;
}

export interface CreateAdminAccountRequest {
  email: string;
  name: string;
  password: string;
  role: string;
  locale?: string;
}

export interface UpdateAdminAccountRequest extends AdminVersion {
  name?: string;
  email?: string;
}

export interface UpdateAdminAccountStatusRequest extends AdminVersion {
  isActive: boolean;
  reason?: string;
}

export interface AdminAccountStatusResult {
  version: number;
  id: string;
  isDeleted: boolean;
  deletedAt?: string;
}

export interface AdminAccountRoleResult {
  version: number;
  id: string;
  role: string;
}

export interface AdminPermissionResult {
  /** Absent only on older servers. Strict writes require an observed version. */
  version?: number;
  userId: string;
  permissions: string[];
}

export interface AdminPermissionList extends AdminPermissionResult {
  role: string;
}

export interface AdminRole {
  version: number;
  audience?: 'customer' | 'staff';
  id: string;
  name: string;
  slug: string;
  description?: string;
  isSystemRole: boolean;
  isProtected: boolean;
  level: number;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminRoleQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface AdminRoleList {
  roles: AdminRole[];
  total: number;
  page: number;
  pages: number;
}

export interface CreateAdminRoleRequest {
  audience?: 'customer' | 'staff';
  name: string;
  permissions: string[];
  description?: string;
  level?: number;
}

export type UpdateAdminRoleRequest = Partial<Omit<CreateAdminRoleRequest, 'audience'>> &
  AdminVersion;

export interface AdminRoleUpdateResult extends AdminRole {
  usersMoved: number;
}

export interface AdminSession extends Session {
  clientId: string;
  isCurrent: false;
}

export interface AdminSessionList {
  sessions: AdminSession[];
  total: number;
  targetClass: 'customer' | 'staff';
}

export interface AdminSessionRevokeResult {
  revoked: true;
}

export interface AdminSessionsRevokeResult {
  revokedCount: number;
}

export interface AdminActivity {
  id: string;
  occurredAt: string;
  action: string;
  outcome: string;
  actorId: string | null;
  targetUserId: string | null;
  clientId: string | null;
  sessionId: string | null;
  details: Record<string, string | number | boolean | string[]>;
  roleAssignment: { assignedRoleId: string; previousRoleId: string | null } | null;
}

export interface AdminActivityQuery {
  page?: number;
  limit?: number;
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
}

export interface AdminActivityList {
  data: AdminActivity[];
  pagination: AdminPagination;
}

export interface ApiClientAdmin<TSignal extends TransportSignal = TransportSignal> {
  admin: {
    // feature:invitations:start
    invitations: {
      list(
        query?: AdminInvitationQuery,
        options?: CallOptions<TSignal>,
      ): Promise<AdminInvitationPage>;
      create(
        body: CreateAdminInvitationRequest,
        options?: AdminCreateOptions<TSignal>,
      ): Promise<AdminInvitation>;
      resend(id: string, options?: CallOptions<TSignal>): Promise<AdminInvitation>;
      revoke(id: string, options?: CallOptions<TSignal>): Promise<void>;
    };
    // feature:invitations:end
    accounts: {
      list(query?: AdminAccountQuery, options?: CallOptions<TSignal>): Promise<AdminAccountList>;
      create(
        body: CreateAdminAccountRequest,
        options?: AdminCreateOptions<TSignal>,
      ): Promise<AdminAccount>;
      get(id: string, options?: CallOptions<TSignal>): Promise<AdminAccount>;
      update(
        id: string,
        body: UpdateAdminAccountRequest,
        options?: CallOptions<TSignal>,
      ): Promise<AdminAccount>;
      resendEmailChange(id: string, options?: AdminVersionOptions<TSignal>): Promise<MessageResult>;
      cancelEmailChange(id: string, options?: AdminVersionOptions<TSignal>): Promise<AdminAccount>;
      updateStatus(
        id: string,
        body: UpdateAdminAccountStatusRequest,
        options?: CallOptions<TSignal>,
      ): Promise<AdminAccountStatusResult>;
      updateRole(
        id: string,
        body: { role: string } & AdminVersion,
        options?: CallOptions<TSignal>,
      ): Promise<AdminAccountRoleResult>;
      delete(id: string, options?: AdminVersionOptions<TSignal>): Promise<void>;
    };
    permissions: {
      list(id: string, options?: CallOptions<TSignal>): Promise<AdminPermissionList>;
      grant(
        id: string,
        body: { permission: string } & AdminVersion,
        options?: CallOptions<TSignal>,
      ): Promise<AdminPermissionResult>;
      revoke(
        id: string,
        permission: string,
        options?: AdminVersionOptions<TSignal>,
      ): Promise<AdminPermissionResult>;
    };
    roles: {
      list(query?: AdminRoleQuery, options?: CallOptions<TSignal>): Promise<AdminRoleList>;
      get(idOrSlug: string, options?: CallOptions<TSignal>): Promise<AdminRole>;
      create(
        body: CreateAdminRoleRequest,
        options?: AdminCreateOptions<TSignal>,
      ): Promise<AdminRole>;
      update(
        idOrSlug: string,
        body: UpdateAdminRoleRequest,
        options?: CallOptions<TSignal>,
      ): Promise<AdminRoleUpdateResult>;
      delete(idOrSlug: string, options?: AdminVersionOptions<TSignal>): Promise<void>;
    };
    sessions: {
      list(id: string, options?: CallOptions<TSignal>): Promise<AdminSessionList>;
      revoke(
        id: string,
        sessionId: string,
        options?: CallOptions<TSignal>,
      ): Promise<AdminSessionRevokeResult>;
      revokeAll(id: string, options?: CallOptions<TSignal>): Promise<AdminSessionsRevokeResult>;
    };
    activity: {
      list(query?: AdminActivityQuery, options?: CallOptions<TSignal>): Promise<AdminActivityList>;
    };
  };
}
