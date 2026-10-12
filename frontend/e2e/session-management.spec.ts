import { test, expect } from './fixtures/authenticated';

const cards = /^session-card-timeline-/;

test.describe('Session Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/sessions');
    await expect(page.getByTestId(cards)).toHaveCount(2);
  });

  test('should display sessions page with active sessions', async ({ page }) => {
    await expect(
      page.getByTestId('sessions-page').getByRole('heading', { level: 1 }),
    ).toHaveAccessibleName(/sessions/i);
    await expect(page.getByTestId('sessions-list')).toHaveAccessibleName(/session list/i);
    await expect(page.getByTestId(cards)).toHaveCount(2);
  });

  test('should mark current session with indicator', async ({ page }) => {
    const current = page
      .getByTestId(cards)
      .filter({ has: page.getByTestId('current-session-badge') });
    await expect(current).toHaveCount(1);
    await expect(current.getByTestId('current-session-badge')).toBeVisible();
    await expect(current.getByTestId('logout-session-button')).toHaveCount(0);
  });

  test('should display session details correctly', async ({ page }) => {
    const current = page
      .getByTestId(cards)
      .filter({ has: page.getByTestId('current-session-badge') });
    await expect(current.getByTestId(/^device-icon-/)).toBeVisible();
    await expect(current.getByTestId('session-browser-os')).toContainText(/Chrome/i);
    await expect(current.getByTestId('session-ip')).toContainText(/127\.0\.0\.1/);
    await expect(current.getByTestId('session-last-activity')).toContainText(/last active/i);
  });

  test('should show logout confirmation dialog for non-current session', async ({ page }) => {
    await page.getByTestId('logout-session-button').click();
    const dialog = page.getByTestId('logout-session-confirm-dialog');
    await expect(dialog).toHaveRole('alertdialog');
    await expect(dialog).toHaveAccessibleName(/log\s?out/i);
    await expect(dialog.getByTestId('cancel-logout-button')).toBeVisible();
    await expect(dialog.getByTestId('confirm-logout-button')).toBeVisible();
  });

  test('should cancel session logout', async ({ page }) => {
    await page.getByTestId('logout-session-button').click();
    await page.getByTestId('cancel-logout-button').click();
    await expect(page.getByTestId('logout-session-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId(cards)).toHaveCount(2);
  });

  test('should logout a session successfully', async ({ page }) => {
    await page.getByTestId('logout-session-button').click();
    await page.getByTestId('confirm-logout-button').click();
    await expect(page.getByTestId('logout-session-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId(cards)).toHaveCount(1);
    await expect(page.getByTestId('current-session-badge')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeHidden();
    await expect(
      page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
    ).toContainText(/terminated/i);
  });

  test('should show logout all confirmation dialog', async ({ page }) => {
    await page.getByTestId('logout-all-sessions-button').click();
    const dialog = page.getByTestId('revoke-all-confirm-dialog');
    await expect(dialog).toHaveRole('alertdialog');
    await expect(dialog).toHaveAccessibleName(/log\s?out/i);
    await expect(dialog.getByTestId('cancel-logout-all')).toBeVisible();
    await expect(dialog.getByTestId('confirm-logout-all')).toBeVisible();
  });

  test('should cancel logout all sessions', async ({ page }) => {
    await page.getByTestId('logout-all-sessions-button').click();
    await page.getByTestId('cancel-logout-all').click();
    await expect(page.getByTestId('revoke-all-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId(cards)).toHaveCount(2);
  });

  test('should logout all other sessions successfully', async ({ page }) => {
    await page.getByTestId('logout-all-sessions-button').click();
    await page.getByTestId('confirm-logout-all').click();
    await expect(page.getByTestId('revoke-all-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId(cards)).toHaveCount(1);
    await expect(page.getByTestId('current-session-badge')).toBeVisible();
    await expect(
      page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
    ).toContainText(/terminated/i);
  });

  test('should disable logout all button when only current session exists', async ({ page }) => {
    await page.getByTestId('logout-all-sessions-button').click();
    await page.getByTestId('confirm-logout-all').click();
    await expect(page.getByTestId(cards)).toHaveCount(1);
    await expect(page.getByTestId('logout-all-sessions-button')).toHaveCount(0);
  });

  test('should auto-refresh session list every 30 seconds', async ({ page }) => {
    await page.clock.install();
    const response = page.waitForResponse(
      (res) => res.url().endsWith('/api/user/sessions') && res.request().method() === 'GET',
    );
    await page.clock.runFor(30001);
    expect((await response).status()).toBe(200);
    await expect(page.getByTestId(cards)).toHaveCount(2);
  });

  test('should handle network errors gracefully', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'expected-api-error',
      description: JSON.stringify({ path: '/api/user/sessions', status: 500 }),
    });
    await page.route('**/api/user/sessions', (route) =>
      route.fulfill({
        status: 500,
        json: {
          success: false,
          error: { message: 'Fixture failure', code: 'INTERNAL_ERROR' },
        },
      }),
    );
    await page.getByTestId('refresh-sessions-button').click();
    await expect(page.getByTestId('stale-list-notice')).toBeVisible();
    await expect(page.getByTestId(cards)).toHaveCount(2);
    await expect(page.getByTestId('retry-refresh-sessions-button')).toBeVisible();
    await page.unroute('**/api/user/sessions');
    await page.getByTestId('retry-refresh-sessions-button').click();
    await expect(page.getByTestId('stale-list-notice')).not.toBeVisible();
    await expect(page.getByTestId(cards)).toHaveCount(2);
  });
});
