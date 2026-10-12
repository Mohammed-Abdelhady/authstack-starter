/**
 * Combine what the role grants with what the account holds directly.
 *
 * @param rolePermissions - The role's permissions, or null when no role carries the slug
 * @param directPermissions - Permissions stored on the account itself
 */
export function effectivePermissions(
  rolePermissions: string[] | null,
  directPermissions: string[] | undefined,
): string[] {
  return [
    ...new Set([...(rolePermissions ?? []), ...(directPermissions ?? [])]),
  ];
}
