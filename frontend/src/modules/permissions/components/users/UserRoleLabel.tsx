'use client';

import { useListRolesQuery } from '../../api/rolesApi';

export interface UserRoleLabelProps {
  /** The slug stored on the user. */
  readonly slug: string;
}

/**
 * The role of a user as read-only text: the role's name, from the list the
 * role selector reads. Until that list answers, or for a role it does not
 * hold, the slug is shown as it is.
 */
export function UserRoleLabel({ slug }: UserRoleLabelProps): React.JSX.Element {
  const { data } = useListRolesQuery(undefined);
  const name = (data?.roles ?? []).find((role) => role.slug === slug)?.name;

  return (
    <span dir={name ? 'auto' : 'ltr'} className="font-medium" data-testid="user-card-role">
      {name ?? slug}
    </span>
  );
}
