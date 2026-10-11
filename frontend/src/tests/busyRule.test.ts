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
const MENU_ENTRIES: Record<string, string[]> = {
  'modules/permissions/components/users/UserActionsMenu.tsx': ['isLoading'],
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

  it.each([
    'busy={isLoading}',
    'aria-disabled={isRetrying}',
    'disabled={isFirstPage}',
    'disabled={!acknowledged}',
    'disabled={isLoadingRoles}',
    'disabled={role.isProtected}',
    'isDisabled={isLoading}',
  ])('accepts %s', (source) => {
    expect(disabledWhileRequestRuns(source)).toEqual([]);
  });

  it('finds none in the components of this application', () => {
    const offenders = componentFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path).split('\\').join('/');
      const allowed = MENU_ENTRIES[file] ?? [];
      return disabledWhileRequestRuns(readFileSync(path, 'utf8'))
        .filter((expression) => !allowed.includes(expression))
        .map((expression) => `${file}: disabled={${expression}}`);
    });

    expect(offenders).toEqual([]);
  });
});
