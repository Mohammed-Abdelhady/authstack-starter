/**
 * What a role grants, read by slug. A request and a sign-in ask this to tell
 * an account what it may do. One plain read that commits nothing.
 */
export abstract class RolePermissions {
  /** The role's permissions, or null when no role carries the slug. */
  abstract ofRole(slug: string): Promise<string[] | null>;
}
