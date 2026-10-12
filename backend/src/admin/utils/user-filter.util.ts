import { escapeRegex } from '../../common/utils/escape-regex';

/**
 * Build the Mongo filter for a user listing.
 * The role filter is always bounded by the slugs the actor may see.
 *
 * @param query - Validated listing query
 * @param viewableRoles - Role slugs at or below the actor's level
 */
export function buildUserFilter(
  query: {
    search?: string;
    role?: string;
    status?: 'active' | 'inactive' | 'deleted';
    isVerified?: boolean;
  },
  viewableRoles: string[],
): Record<string, unknown> {
  const { search, role, status, isVerified } = query;
  const filter: Record<string, unknown> = { role: { $in: viewableRoles } };

  if (search) {
    const escaped = escapeRegex(search);
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
    ];
  }

  if (role && viewableRoles.includes(role)) {
    filter.role = role;
  }

  if (isVerified !== undefined) {
    filter.isVerified = isVerified;
  }

  if (status === 'deleted') {
    filter.isDeleted = true;
  } else if (status === 'inactive') {
    filter.isVerified = false;
    filter.isDeleted = false;
  } else if (status === 'active') {
    filter.isVerified = true;
    filter.isDeleted = false;
  }

  return filter;
}

/**
 * Build the Mongo sort document for a user listing.
 *
 * @param sortBy - Field to sort on
 * @param sortOrder - Ascending or descending
 */
export function buildUserSort(
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): Record<string, 1 | -1> {
  return { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
}
