import { auditAccessibility } from './utils/accessibility';
import { test, expect, API } from './fixtures/authenticated';
import { message } from './utils/messages';

test.describe('User administration through real API state', () => {
  test('admin creates, edits and deactivates a custom-role user', async ({ page }) => {
    await page.goto('/en/admin/users');
    await page.getByTestId('create-user-button').filter({ visible: true }).click();
    await page.getByTestId('create-user-name-input').fill('Created User');
    await page.getByTestId('create-user-email-input').fill('created@example.test');
    await page.getByTestId('create-user-password-input').fill('Created123!');
    await page.getByTestId('create-user-role-select').click();
    await page.getByTestId('role-option-fixture-editor').click();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/users') && response.request().method() === 'POST',
    );
    await page.getByTestId('submit-create-user-button').click();
    const response = await created;
    expect(response.status()).toBe(201);
    const user = (await response.json()).data;
    const id = user.id ?? user._id;
    await expect(page.getByTestId(`user-card-${id}`)).toBeVisible();
    await page.getByTestId(`user-actions-menu-${id}`).click();
    await page.getByTestId(`edit-user-${id}`).click();
    await page.getByTestId('edit-user-name-input').fill('Edited User');
    await page.getByTestId('submit-edit-user-button').click();
    await expect(page.getByTestId('edit-user-dialog')).toBeHidden();
    expect((await (await page.request.get(`${API}/admin/users/${id}`)).json()).data.name).toBe(
      'Edited User',
    );
    await page.getByTestId(`user-actions-menu-${id}`).click();
    await expect(page.getByTestId(`deactivate-user-${id}`)).toBeVisible();
    await page.getByTestId(`deactivate-user-${id}`).click();
    const deactivated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/admin/users/${id}/status`) &&
        response.request().method() === 'PATCH',
    );
    await page.getByTestId('confirm-user-action-button').click();
    expect((await deactivated).status()).toBe(200);
    // The confirmation stays open until the server has answered.
    await expect(page.getByTestId('user-action-confirm-dialog')).toBeHidden();
    await expect(
      page.getByTestId(`user-card-${id}`).getByTestId('user-inactive-badge'),
    ).toBeVisible();
    // The name is wrapped in a first-strong isolate so it keeps its own direction.
    await expect(
      page.getByRole('region', { name: message('en', 'common.toastRegion') }),
    ).toContainText(message('en', 'users.actions.deactivateSuccess', { name: 'Edited User' }));
  });

  test('session confirmation and role dialog have no automated WCAG A/AA violations', async ({
    page,
  }, info) => {
    await page.goto('/en/sessions');
    await info.attach('session-page', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.getByTestId('logout-all-sessions-button').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await auditAccessibility(page, info, 'session-dialog');
    await page.getByTestId('cancel-logout-all').click();
    await page.goto('/en/admin/roles');
    await page.getByTestId('create-role-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await auditAccessibility(page, info, 'role-dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});

test.describe('User administration denied to ordinary users', () => {
  test.use({ actor: { email: 'user@seed.local', password: 'User123!' } });
  test('admin navigation and direct user APIs remain unavailable', async ({ page }, info) => {
    for (const path of ['/api/roles', '/api/admin/users'])
      info.annotations.push({
        type: 'expected-api-error',
        description: JSON.stringify({ path, status: 403 }),
      });
    await expect(page.getByTestId('nav-link-users')).toBeHidden();
    expect((await page.request.get(`${API}/admin/users`)).status()).toBe(403);
    await page.goto('/en/admin/users');
    await expect(page.getByTestId('create-user-button')).toBeHidden();
    await expect(page.getByTestId('error-page-main')).toBeVisible();
  });
});

test.describe('Arabic session accessibility', () => {
  test.use({ appLocale: 'ar' });
  test('current session metadata and confirmation retain readable contrast', async ({
    page,
  }, info) => {
    await page.goto('/ar/sessions');
    await expect(page.getByTestId('sessions-page')).toBeVisible();
    await expect(page.getByTestId('sessions-list')).toBeVisible();
    await expect(page.getByTestId('logout-session-button').first()).toBeVisible();
    await auditAccessibility(page, info, 'ar-session');
    await info.attach('ar-sessions', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.getByTestId('logout-all-sessions-button').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await auditAccessibility(page, info, 'ar-session-dialog');
    await page.getByTestId('cancel-logout-all').click();
  });
});
