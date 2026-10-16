import { StoredAccount } from '../../user/stores/stored-account';
import { AdminUserDto } from '../dto/admin-user-response.dto';

/**
 * Map a stored account to the shape returned by the admin endpoints.
 *
 * @param user - The account as a store read it
 */
export function mapToAdminUserDto(user: StoredAccount): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions || [],
    authProvider: user.authProvider,
    isVerified: user.isVerified,
    ...(user.pendingEmail === undefined
      ? {}
      : { pendingEmail: user.pendingEmail }),
    isDeleted: user.isDeleted,
    avatarUrl: user.avatarUrl,
    linkedProviders: user.linkedProviders,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    version: user.version ?? 0,
  };
}
