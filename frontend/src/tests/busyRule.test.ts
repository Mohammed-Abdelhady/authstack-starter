import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { disabledWhileRequestRuns } from './busyRule';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Not native controls: an entry of the library's menu takes `disabled` as
 * `aria-disabled` on an element that is gone once the menu closes.
 */
const KNOWN_DISABLED: Record<string, string[]> = {
  'components/forms/FormCheckbox.tsx': ['disabled', 'disabled || option.disabled'],
  'components/forms/FormSelect.tsx': ['disabled'],
  'components/forms/SubmitButton.tsx': ['disabled'],
  'components/pagination/PaginationControl.tsx': ['isFirstPage', 'isLastPage'],
  'modules/account/components/LinkProviderButton.tsx': ['disabled'],
  'modules/account/components/ProfileSyncStatus.tsx': ['!canSync'],
  'modules/oauth/components/OAuthButton.tsx': ['disabled'],
  'modules/oauth/components/OAuthButtons.tsx': ['disabled'],
  'modules/permissions/components/roles/EditRoleForm.tsx': [
    'isProtected || isBaseRole',
    'isBaseRole',
  ],
  'modules/permissions/components/roles/RoleDetailPanel.tsx': ['isBaseRole', 'role.isProtected'],
  'modules/permissions/components/search/PermissionSearchDialog.tsx': ['availableCount === 0'],
  'modules/permissions/components/search/SearchPermissionTabs.tsx': ['groupPerms.length === 0'],
  'modules/permissions/components/users/CreateUserDialog.tsx': ['allRoles.isError'],
  'modules/permissions/components/users/CreateUserRoleField.tsx': ['isLoadingRoles'],
  'modules/permissions/components/users/UserActionsMenu.tsx': ['disabled', 'isLoading'],
  'modules/permissions/components/users/UserCard.tsx': ['isAdminRole'],
  'modules/permissions/components/users/UserRoleSelector.tsx': ['disabled || isLoadingRoles'],
  'modules/two-factor/components/steps/RecoveryCodesStep.tsx': ['!acknowledged'],
};

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('finding controls that are disabled while a request runs', () => {
  it.each([
    ['disabled={isLoading}', ['isLoading']],
    ['disabled={disabled || isLoading}', ['disabled || isLoading']],
    ['disabled={ isFetching }', ['isFetching']],
    ['<Button disabled={busy} /><Input disabled={isUpdatingRole} />', ['busy', 'isUpdatingRole']],
    ['disabled={isFirstPage || isSubmitting}', ['isFirstPage || isSubmitting']],
  ])('reports %s', (source, found) => {
    expect(disabledWhileRequestRuns(source)).toEqual(found);
  });

  it.each(['busy={isLoading}', 'aria-disabled={isRetrying}', 'isDisabled={isLoading}'])(
    'accepts %s',
    (source) => {
      expect(disabledWhileRequestRuns(source)).toEqual([]);
    },
  );

  it('finds none in the components of this application', () => {
    const offenders = componentFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path).split('\\').join('/');
      const found = disabledWhileRequestRuns(readFileSync(path, 'utf8'));
      const known = KNOWN_DISABLED[file] ?? [];
      return found.join('\n') === known.join('\n') ? [] : [`${file}: ${found.join(', ')}`];
    });

    expect(offenders).toEqual([]);
  });

  it('reports a new request-state alias regardless of its name', () => {
    expect(disabledWhileRequestRuns('disabled={pending}')).toEqual(['pending']);
    expect(disabledWhileRequestRuns('disabled={isVerifying}')).toEqual(['isVerifying']);
  });
});
