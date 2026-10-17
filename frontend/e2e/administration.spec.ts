import type { Page } from '@playwright/test';
import { test, expect, API, type FixtureMail } from './fixtures/authenticated';
import { CSRF_HEADER, sessionBrowserProof } from './utils/browser-proof';
import { message } from './utils/messages';

test.use({ staffStrict: true });

const PENDING_EMAIL = 'edited@example.test';

test.describe('User administration through real API state', () => {
  test('admin creates, edits and deactivates a custom-role user', async ({
    page,
    actor,
    expireStaffProof,
    fixtureMail,
  }, info) => {
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
    expect(response.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.status()).toBe(201);
    const user = (await response.json()).data;
    const id = user.id ?? user._id;
    expect(Number.isSafeInteger(user.version)).toBe(true);
    await expect(page.getByTestId(`user-card-${id}`)).toBeVisible();
    await page.getByTestId(`user-actions-menu-${id}`).click();
    await page.getByTestId(`edit-user-${id}`).click();
    const concurrent = await page.request.patch(`${API}/admin/users/${id}`, {
      headers: { [CSRF_HEADER]: await sessionBrowserProof(page.request, API) },
      data: { name: 'Concurrent rename', email: user.email, version: user.version },
    });
    expect(concurrent.status()).toBe(200);
    const next = (await concurrent.json()).data;
    info.annotations.push({
      type: 'expected-api-error',
      description: JSON.stringify({ path: `/api/admin/users/${id}`, status: 409 }),
    });
    await page.getByTestId('edit-user-name-input').fill('Edited User');
    const stale = page.waitForResponse(
      (answer) =>
        answer.url().endsWith(`/admin/users/${id}`) && answer.request().method() === 'PATCH',
    );
    await page.getByTestId('submit-edit-user-button').click();
    const refused = await stale;
    expect(refused.status()).toBe(409);
    expect(refused.request().postDataJSON().version).toBe(user.version);
    await expect(page.getByTestId('edit-user-dialog')).toBeVisible();
    expect((await (await page.request.get(`${API}/admin/users/${id}`)).json()).data.name).toBe(
      'Concurrent rename',
    );
    await page.reload();
    await page.getByTestId(`user-actions-menu-${id}`).click();
    await page.getByTestId(`edit-user-${id}`).click();
    await page.getByTestId('edit-user-name-input').fill('Edited User');
    await page.getByTestId('edit-user-email-input').fill(PENDING_EMAIL);
    await expireStaffProof();
    info.annotations.push({
      type: 'expected-api-error',
      description: JSON.stringify({ path: `/api/admin/users/${id}`, status: 401 }),
    });
    const needsProof = page.waitForResponse(
      (answer) =>
        answer.url().endsWith(`/admin/users/${id}`) && answer.request().method() === 'PATCH',
    );
    await page.getByTestId('submit-edit-user-button').click();
    const pending = await needsProof;
    expect(pending.status()).toBe(401);
    expect((await pending.json()).error.code).toBe('REAUTH_REQUIRED');
    expect(pending.request().postDataJSON().version).toBe(next.version);
    expect(pending.request().postDataJSON().email).toBe(PENDING_EMAIL);
    await expect(page.getByTestId('edit-user-dialog')).toBeVisible();
    const unchanged = await page.request.get(`${API}/admin/users/${id}`);
    expect(unchanged.status()).toBe(200);
    const unchangedUser = (await unchanged.json()).data;
    expect(unchangedUser).toMatchObject({
      id,
      name: 'Concurrent rename',
      email: user.email,
      version: next.version,
    });
    expect(unchangedUser.pendingEmail).toBeUndefined();
    const sent = page.waitForResponse(
      (answer) =>
        answer.url().endsWith('/api/auth/proof/code') && answer.request().method() === 'POST',
    );
    await page.getByTestId('invitation-proof-send').click();
    expect((await sent).status()).toBe(200);
    await expect(page.getByTestId('invitation-proof-code')).toBeVisible();
    const mail = (await fixtureMail()).findLast((entry) => entry.to === actor.email);
    const code = mail?.text?.match(/\b\d{6}\b/)?.[0];
    if (!code) throw new Error('Proof fixture did not deliver a code');
    await page.getByTestId('invitation-proof-code').fill(code);
    const proved = page.waitForResponse(
      (answer) =>
        answer.url().endsWith('/api/auth/proof/code/verify') &&
        answer.request().method() === 'POST',
    );
    const saved = page.waitForResponse(
      (answer) =>
        answer.url().endsWith(`/admin/users/${id}`) && answer.request().method() === 'PATCH',
    );
    await page.getByTestId('invitation-proof-verify').click();
    expect((await proved).status()).toBe(200);
    const updated = await saved;
    expect(updated.status()).toBe(200);
    expect(updated.request().postDataJSON().version).toBe(next.version);
    expect(updated.request().postDataJSON().email).toBe(PENDING_EMAIL);
    expect((await updated.json()).data.version).toBe(next.version + 1);
    await expect(page.getByTestId('edit-user-dialog')).toBeHidden();
    await resendPendingAddress({
      page,
      fixtureMail,
      expected: { id, name: 'Edited User', email: user.email, version: next.version + 1 },
    });
    await page.getByTestId(`user-actions-menu-${id}`).click();
    await expect(page.getByTestId(`deactivate-user-${id}`)).toBeVisible();
    await page.getByTestId(`deactivate-user-${id}`).click();
    const deactivated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/admin/users/${id}/status`) &&
        response.request().method() === 'PATCH',
    );
    await page.getByTestId('confirm-user-action-button').click();
    const deactivatedResponse = await deactivated;
    expect(deactivatedResponse.status()).toBe(200);
    expect(deactivatedResponse.request().postDataJSON().version).toBe(next.version + 1);
    const persisted = await page.request.get(`${API}/admin/users`, {
      params: { search: user.email, status: 'deleted', page: 1, limit: 10 },
    });
    expect(persisted.status()).toBe(200);
    expect((await persisted.json()).data.data).toEqual([
      expect.objectContaining({
        id,
        name: 'Edited User',
        email: user.email,
        isDeleted: true,
        version: next.version + 2,
      }),
    ]);
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

async function resendPendingAddress(options: {
  page: Page;
  fixtureMail: () => Promise<FixtureMail[]>;
  expected: { id: string; name: string; email: string; version: number };
}) {
  const { page, fixtureMail, expected } = options;
  const accountPath = `${API}/admin/users/${expected.id}`;
  const persistedEdit = await page.request.get(accountPath);
  expect(persistedEdit.status()).toBe(200);
  const observed = (await persistedEdit.json()).data;
  const unchanged = { ...expected, isVerified: true, pendingEmail: PENDING_EMAIL };
  expect(observed).toMatchObject(unchanged);
  expect((await fixtureMail()).filter((mail) => mail.to === PENDING_EMAIL)).toHaveLength(1);
  await page.getByTestId(`user-actions-menu-${expected.id}`).click();
  const resend = page.getByTestId(`resend-email-change-${expected.id}`);
  await expect(resend).toBeVisible();
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/users/${expected.id}/resend-email-change`) &&
      response.request().method() === 'POST',
  );
  await resend.click();
  const response = await sent;
  expect(response.request().postDataJSON()).toEqual({ version: observed.version });
  expect(response.status()).toBe(200);
  expect((await fixtureMail()).filter((mail) => mail.to === PENDING_EMAIL)).toHaveLength(2);
  const persistedResend = await page.request.get(accountPath);
  expect(persistedResend.status()).toBe(200);
  expect((await persistedResend.json()).data).toMatchObject(unchanged);
}
