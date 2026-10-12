// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { SearchPermissionTabs } from '../search/SearchPermissionTabs';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** A leading colon is what an rtl sentence moves to the far end. */
const QUERY = ':read';
/** Left-to-right isolate and pop directional isolate, written out. */
const ISOLATED_QUERY = `\u2066${QUERY}\u2069`;

registerFormTestLifecycle();

async function renderTabs(locale: AppLocale, activeTab: string, searchQuery = QUERY) {
  return renderForm(
    locale,
    <SearchPermissionTabs
      activeTab={activeTab}
      onTabChange={vi.fn()}
      filteredGroups={[]}
      selectedPermissions={[]}
      onSelectAll={vi.fn()}
      onTogglePermission={vi.fn()}
      searchQuery={searchQuery}
    />,
  );
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('permission search with no match in %s', (locale) => {
  it('isolates the typed query inside the sentence for all categories', async () => {
    const { message } = await renderTabs(locale, 'all');

    const [before, after] = message('permissions.searchDialog.noPermissionsMatch').split(
      '\u2066{query}\u2069',
    );
    expect(screen.getByRole('tabpanel').textContent).toBe(`${before}${ISOLATED_QUERY}${after}`);
  });

  it('isolates the typed query inside the sentence for one category', async () => {
    const { message, format } = await renderTabs(locale, 'users');

    // The category is named as the tab names it, so the sentence needs no inflection.
    const category = message('permissions.selector.groups.users');
    const sentence = format('permissions.searchDialog.noCategoryPermissionsMatch', {
      category,
      query: QUERY,
    });
    const panel = screen.getByRole('tabpanel').textContent;
    expect(panel).toBe(sentence);
    expect(panel).toContain(ISOLATED_QUERY);
  });

  it('names the category as its tab does when nothing is left to assign', async () => {
    const { message, format } = await renderTabs(locale, 'users', '');

    expect(screen.getByRole('tabpanel').textContent).toBe(
      format('permissions.searchDialog.categoryAllAssigned', {
        category: message('permissions.selector.groups.users'),
      }),
    );
  });
});
