/**
 * What the server accepts as a role. The slug of a role is made from its name,
 * which is why the name is held to Latin letters, digits, spaces and hyphens.
 * The server's own check is in `backend/src/role/dto/create-role.dto.ts`.
 */
export const ROLE_NAME_MIN_LENGTH = 2;
export const ROLE_NAME_MAX_LENGTH = 50;
export const ROLE_NAME_PATTERN = /^[a-zA-Z0-9\s-]+$/;
export const ROLE_DESCRIPTION_MAX_LENGTH = 200;
/** The shortest code the forms accept. The server would store a shorter one. */
export const ROLE_SLUG_MIN_LENGTH = 2;

/** What is wrong with a role name, most basic problem first. */
export const ROLE_NAME_PROBLEM = {
  REQUIRED: 'required',
  CHARACTERS: 'characters',
  TOO_SHORT: 'tooShort',
  TOO_LONG: 'tooLong',
  /** The name is allowed, and the code made from it is empty or one character. */
  CODE_TOO_SHORT: 'codeTooShort',
} as const;

export type RoleNameProblem = (typeof ROLE_NAME_PROBLEM)[keyof typeof ROLE_NAME_PROBLEM];

/**
 * The code the server makes from a role name: what it stores as the slug and
 * what must not collide with another role. The server's own function is
 * `generateSlug` in `backend/src/role/utils/role.util.ts`, and a test fails
 * when the two drift apart.
 */
export function roleSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Why this role name is refused, or null when it is not. The first four are
 * the server's own rule. The last is the forms' own: a name of hyphens and
 * spaces gives a code nobody could tell from another.
 * Pass the name as it will be sent.
 */
export function roleNameProblem(name: string): RoleNameProblem | null {
  if (name.length === 0) return ROLE_NAME_PROBLEM.REQUIRED;
  if (!ROLE_NAME_PATTERN.test(name)) return ROLE_NAME_PROBLEM.CHARACTERS;
  if (name.length < ROLE_NAME_MIN_LENGTH) return ROLE_NAME_PROBLEM.TOO_SHORT;
  if (name.length > ROLE_NAME_MAX_LENGTH) return ROLE_NAME_PROBLEM.TOO_LONG;
  if (roleSlug(name).length < ROLE_SLUG_MIN_LENGTH) return ROLE_NAME_PROBLEM.CODE_TOO_SHORT;
  return null;
}

/** Whether the server would refuse this role description for its length. */
export function isRoleDescriptionTooLong(description: string): boolean {
  return description.length > ROLE_DESCRIPTION_MAX_LENGTH;
}
