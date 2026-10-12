import type { Page } from '@playwright/test';
import { test, expect, API } from './fixtures/authenticated';
import { auditAccessibility } from './utils/accessibility';
import { CSRF_HEADER, sessionBrowserProof } from './utils/browser-proof';

async function seedRoles(page: Page) {
  for (let index = 1; index <= 21; index++) {
    const response = await page.request.post(`${API}/roles`, {
      headers: { [CSRF_HEADER]: await sessionBrowserProof(page.request, API) },
      data: {
        name: `Pagination Fixture ${String(index).padStart(2, '0')}`,
        permissions: ['users:read:all'],
      },
    });
    expect(response.status()).toBe(201);
  }
}

for (const locale of ['en', 'ar'] as const) {
  test.describe(`${locale} paginated roles`, () => {
    test.use({ appLocale: locale });

    test('returns from an emptied last page and keeps remaining roles reachable', async ({
      page,
    }, info) => {
      await seedRoles(page);
      await page.goto(`/${locale}/admin/roles`);
      await page.getByTestId('search-roles-input').fill('Pagination Fixture');
      await expect(page.getByTestId(/^role-nav-item-pagination-fixture-/)).toHaveCount(20);
      await expect(page.getByTestId('pagination-previous')).toBeDisabled();
      await page.getByTestId('pagination-next').click();
      await expect(page.getByTestId(/^role-nav-item-pagination-fixture-/)).toHaveCount(1);
      await expect(page.getByTestId('pagination-next')).toBeDisabled();
      await page.getByTestId(/^role-nav-item-pagination-fixture-/).click();
      await page.getByTestId('delete-role-button').click();
      await page.getByRole('dialog').getByTestId('delete-role-button').click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByTestId(/^role-nav-item-pagination-fixture-/)).toHaveCount(20);
      await expect(page.getByTestId('pagination-controls')).toBeHidden();
      await expect(page.getByTestId('role-detail-panel')).toBeVisible();
      const remaining = await page.request.get(`${API}/roles`, {
        params: { page: 1, limit: 20, search: 'Pagination Fixture' },
      });
      expect((await remaining.json()).data.total).toBe(20);
      await info.attach('roles-after-last-page-delete', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      await page.getByTestId('search-roles-input').fill('No Matching Fixture');
      await expect(page.getByTestId('empty-state')).toBeVisible();
      await page.getByTestId('clear-role-search-button').click();
      await expect(page.getByTestId('role-sidebar-nav')).toBeVisible();
      await expect(page.getByTestId('pagination-previous')).toBeDisabled();
    });

    test('searches and selects a later-page role, preserving selection through retry', async ({
      page,
    }, info) => {
      await seedRoles(page);
      const firstPage = await (
        await page.request.get(`${API}/roles`, { params: { page: 1, limit: 20 } })
      ).json();
      const laterPage = await (
        await page.request.get(`${API}/roles`, { params: { page: 2, limit: 20 } })
      ).json();
      const later = laterPage.data.roles.find((role: { slug: string }) =>
        role.slug.startsWith('pagination-fixture-'),
      ) as { slug: string; name: string };
      expect(later).toBeDefined();
      expect(firstPage.data.roles.map((role: { slug: string }) => role.slug)).not.toContain(
        later.slug,
      );
      const created = await page.request.post(`${API}/admin/users`, {
        headers: { [CSRF_HEADER]: await sessionBrowserProof(page.request, API) },
        data: {
          name: 'Filtered Fixture',
          email: 'filtered@example.test',
          password: 'Fixture123!',
          role: later.slug,
        },
      });
      expect(created.status()).toBe(201);
      const user = (await created.json()).data;
      await page.goto(`/${locale}/admin/users`);
      await page.getByTestId('role-filter').focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByTestId('role-filter-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId(/^role-filter-option-/)).toHaveCount(20);
      await dialog.getByTestId('pagination-next').click();
      await expect(dialog.getByTestId(`role-filter-option-${later.slug}`)).toBeVisible();
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/admin/users' && url.searchParams.get('role') === later.slug;
      });
      await dialog.getByTestId(`role-filter-option-${later.slug}`).click();
      expect((await filtered).status()).toBe(200);
      const userCards = page.locator('article[data-testid^="user-card-"]');
      await expect(userCards).toHaveCount(1);
      await expect(page.getByTestId(`user-card-${user.id ?? user._id}`)).toBeVisible();
      await page.getByTestId('role-filter').click();
      await dialog.getByTestId('role-filter-search').fill(later.name);
      await expect(dialog.getByTestId(/^role-filter-option-/)).toHaveCount(1);
      await expect(dialog.getByTestId(`role-filter-option-${later.slug}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await auditAccessibility(page, info, `${locale}-role-filter`);
      await info.attach('searchable-role-filter', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      info.annotations.push({
        type: 'expected-api-error',
        description: JSON.stringify({ path: '/api/roles', status: 503 }),
      });
      let failed = false;
      await page.route('**/api/roles?*', async (route) => {
        if (!failed) {
          failed = true;
          await route.fulfill({
            status: 503,
            json: {
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Temporary fixture failure' },
            },
          });
        } else await route.continue();
      });
      await dialog.getByTestId('role-filter-search').fill('Pagination Fixture');
      await expect(dialog.getByTestId('role-filter-retry')).toBeVisible();
      await dialog.getByTestId('role-filter-retry').click();
      await expect(dialog.getByTestId(/^role-filter-option-/)).toHaveCount(20);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(userCards).toHaveCount(1);
      await expect(page.getByTestId('role-filter-value')).toHaveText(later.name);
      await page.getByTestId('role-filter').click();
      await dialog.getByTestId('role-filter-all').click();
      await expect(userCards).not.toHaveCount(1);
    });
  });
}
