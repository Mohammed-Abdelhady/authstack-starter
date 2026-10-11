/**
 * What the server accepts as a role. The slug of a role is made from its name,
 * which is why the name is held to Latin letters, digits, spaces and hyphens.
 * The server's own check is in `backend/src/role/dto/create-role.dto.ts`.
 */
export const ROLE_NAME_MIN_LENGTH = 2;
export const ROLE_NAME_MAX_LENGTH = 50;
export const ROLE_NAME_PATTERN = /^[a-zA-Z0-9\s-]+$/;
export const ROLE_DESCRIPTION_MAX_LENGTH = 200;

/** What is wrong with a role name, most basic problem first. */
export const ROLE_NAME_PROBLEM = {
  REQUIRED: 'required',
  CHARACTERS: 'characters',
  TOO_SHORT: 'tooShort',
  TOO_LONG: 'tooLong',
} as const;

export type RoleNameProblem = (typeof ROLE_NAME_PROBLEM)[keyof typeof ROLE_NAME_PROBLEM];

/**
 * Why the server would refuse this role name, or null when it would not.
 * Pass the name as it will be sent.
 */
export function roleNameProblem(name: string): RoleNameProblem | null {
  if (name.length === 0) return ROLE_NAME_PROBLEM.REQUIRED;
  if (!ROLE_NAME_PATTERN.test(name)) return ROLE_NAME_PROBLEM.CHARACTERS;
  if (name.length < ROLE_NAME_MIN_LENGTH) return ROLE_NAME_PROBLEM.TOO_SHORT;
  if (name.length > ROLE_NAME_MAX_LENGTH) return ROLE_NAME_PROBLEM.TOO_LONG;
  return null;
}

/** Whether the server would refuse this role description for its length. */
export function isRoleDescriptionTooLong(description: string): boolean {
  return description.length > ROLE_DESCRIPTION_MAX_LENGTH;
}
