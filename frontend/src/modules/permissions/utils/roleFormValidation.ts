import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  ROLE_NAME_MIN_LENGTH,
  ROLE_NAME_PROBLEM,
  isRoleDescriptionTooLong,
  roleNameProblem,
  type RoleNameProblem,
} from '@app/core';

type Translate = (key: string, values?: Record<string, number>) => string;

/** The key under `roles.form` that says what is wrong with a role name. */
const NAME_PROBLEM_KEYS: Record<RoleNameProblem, string> = {
  [ROLE_NAME_PROBLEM.REQUIRED]: 'nameError',
  [ROLE_NAME_PROBLEM.CHARACTERS]: 'nameCharacters',
  [ROLE_NAME_PROBLEM.TOO_SHORT]: 'nameTooShort',
  [ROLE_NAME_PROBLEM.TOO_LONG]: 'nameTooLong',
  [ROLE_NAME_PROBLEM.CODE_TOO_SHORT]: 'nameCodeTooShort',
};

/** The lengths a role name may have, as the arguments of the messages about it. */
export const ROLE_NAME_LENGTHS = { min: ROLE_NAME_MIN_LENGTH, max: ROLE_NAME_MAX_LENGTH };

export interface RoleFormValues {
  name: string;
  description: string;
  permissions: readonly string[];
  /** False for a role whose name the form does not let the person change. */
  nameIsEditable?: boolean;
}

/**
 * The problems of a role form by field, in the words of `roles.form`. It
 * applies the server's own rule to what the form will send, so a name the
 * server always refuses is caught here with a message that says what is allowed.
 */
export function validateRoleForm(
  { name, description, permissions, nameIsEditable = true }: RoleFormValues,
  t: Translate,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const nameProblem = nameIsEditable ? roleNameProblem(name.trim()) : null;

  if (nameProblem) errors.name = t(NAME_PROBLEM_KEYS[nameProblem], ROLE_NAME_LENGTHS);
  if (isRoleDescriptionTooLong(description.trim())) {
    errors.description = t('descriptionTooLong', { max: ROLE_DESCRIPTION_MAX_LENGTH });
  }
  if (permissions.length === 0) errors.permissions = t('permissionsError');
  return errors;
}

/** The fields of a role form that can take focus, in the order they are on the page. */
const ROLE_FORM_FIELDS = ['name', 'description'] as const;

/** The first field on the page that has a problem, for the focus to go to. */
export function firstInvalidRoleField(errors: Record<string, string>): string | undefined {
  return ROLE_FORM_FIELDS.find((field) => Boolean(errors[field]));
}
