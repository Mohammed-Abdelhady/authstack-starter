import type { AdminAccountQuery } from '../../stores/admin-account.store';

export function statusFilter(query: AdminAccountQuery): {
  isVerified?: boolean;
  isDeleted?: boolean;
} {
  if (query.status === 'deleted') {
    return { isVerified: query.isVerified, isDeleted: true };
  }
  if (query.status === 'inactive') {
    return { isVerified: false, isDeleted: false };
  }
  if (query.status === 'active') {
    return { isVerified: true, isDeleted: false };
  }
  return { isVerified: query.isVerified };
}
