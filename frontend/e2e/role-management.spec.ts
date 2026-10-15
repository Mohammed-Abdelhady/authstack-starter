import { test, expect } from './fixtures/authenticated';

test.describe('Role Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/admin/roles');
    await expect(page.getByTestId('role-sidebar-nav')).toBeVisible();
  });

  test('should create a new role successfully', async ({ page }) => {
    await page.getByTestId('create-role-button').click();
    const dialog = page.getByTestId('create-role-dialog');
    await dialog.getByTestId('role-name-input').fill('Test Manager');
    await dialog.getByTestId('role-description-input').fill('Test role for E2E testing');
    await dialog.getByTestId('permission-checkbox-users:read:all').click();
    await dialog.getByTestId('permission-checkbox-users:update:all').click();
    await dialog.getByTestId('create-role-button').click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
    ).toContainText(/created/i);
    await expect(page.getByTestId('role-nav-item-test-manager')).toBeVisible();
    await page.getByTestId('role-nav-item-test-manager').click();
    const detail = page.getByTestId('role-detail-panel');
    await expect(detail.getByRole('heading', { level: 2 })).toHaveText('Test Manager');
    await expect(detail.getByTestId('permission-node-users:read:all')).toBeVisible();
    await expect(detail.getByTestId('permission-node-users:update:all')).toBeVisible();
  });

  test('should edit an existing role', async ({ page }) => {
    await page.getByTestId('role-nav-item-fixture-editor').click();
    await page.getByTestId('edit-role-button').click();
    const dialog = page.getByTestId('edit-role-dialog');
    await expect(dialog).toHaveAccessibleName(/edit/i);
    await expect(dialog.getByTestId('edit-role-name-input')).toHaveValue('Fixture Editor');
    await dialog
      .getByTestId('edit-role-description-input')
      .fill('Updated description for E2E test');
    await dialog.getByTestId('save-role-button').click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
    ).toContainText(/updated/i);
    await expect(page.getByTestId('role-detail-panel')).toContainText(
      'Updated description for E2E test',
    );
  });

  test('should cancel role deletion', async ({ page }) => {
    await page.getByTestId('role-nav-item-fixture-editor').click();
    await page.getByTestId('delete-role-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('cancel-button').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId('role-nav-item-fixture-editor')).toBeVisible();
    await expect(page.getByTestId(/^role-nav-item-/)).toHaveCount(5);
  });

  test('should delete a role after confirmation', async ({ page }) => {
    await page.getByTestId('role-nav-item-fixture-editor').click();
    await page.getByTestId('delete-role-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('delete-role-button').click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
    ).toContainText(/deleted/i);
    await expect(page.getByTestId('role-nav-item-fixture-editor')).toHaveCount(0);
    await expect(page.getByTestId(/^role-nav-item-/)).toHaveCount(4);
  });

  test('should not allow deleting protected roles', async ({ page }) => {
    await page.getByTestId('role-nav-item-admin').click();
    await expect(page.getByTestId('delete-role-button')).toBeDisabled();
  });

  test('should not allow editing protected role names', async ({ page }) => {
    await page.getByTestId('role-nav-item-admin').click();
    await expect(page.getByTestId('edit-role-button')).toBeDisabled();
    await page.getByTestId('role-nav-item-support').click();
    await page.getByTestId('edit-role-button').click();
    const dialog = page.getByTestId('edit-role-dialog');
    await expect(dialog.getByTestId('edit-role-name-input')).toBeDisabled();
    await expect(dialog.getByTestId('edit-role-description-input')).toBeEditable();
  });
});
