import { test, expect } from './fixtures/authenticated';
import { settleAnimations } from './utils/accessibility';

const identity = (url: string) => url.endsWith('/api/auth/identity');

for (const actor of [
  { email: 'admin@seed.local', password: 'Admin123!', landing: '/admin/dashboard' },
  { email: 'user@seed.local', password: 'User123!', landing: '/dashboard' },
]) {
  test.describe(`Validated ${actor.email} session`, () => {
    test.use({ actor });
    test('keeps its destination and identity across three full reloads', async ({
      page,
    }, testInfo) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await page.context().clearCookies();
          await page.goto('/en/auth/login');
          await page.getByTestId('login-email-input').fill(actor.email);
          await page.getByTestId('login-password-input').fill(actor.password);
          await page.getByTestId('login-submit').click();
          await expect(page).toHaveURL(`http://127.0.0.1:3107/en${actor.landing}`);
        }
        const validated = page.waitForResponse(
          (response) => identity(response.url()) && response.status() === 200,
        );
        await page.reload();
        const response = await validated;
        const identityBody = (await response.json()) as {
          data: { authenticated: boolean; user: { email: string } | null };
        };
        expect(identityBody.data).toMatchObject({
          authenticated: true,
          user: { email: actor.email },
        });
        await expect(page.getByTestId('dashboard-main')).toBeVisible();
        await expect(page).toHaveURL(`http://127.0.0.1:3107/en${actor.landing}`);
        await expect(page.getByTestId('auth-guard-loading')).not.toBeVisible();
      }
      const keys = await page.evaluate(() =>
        Object.keys(JSON.parse(localStorage.getItem('persist:auth')!) as object).sort(),
      );
      expect(keys).toEqual(['_persist', 'isAuthenticated']);
      await testInfo.attach('validated-reloads', {
        body: await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true }),
        contentType: 'image/png',
      });
    });
  });
}

test.describe('Explicit destination', () => {
  test.use({ returnPath: '/sessions' });
  test('honors the return path after real login and reload', async ({ page }) => {
    await expect(page.getByTestId('sessions-list')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('sessions-list')).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:3107/en/sessions');
  });
});

test('healthy signed-out identity leaves login usable without an error toast', async ({
  page,
  context,
}, testInfo) => {
  await context.clearCookies();
  const anonymous = page.waitForResponse(
    (response) => identity(response.url()) && response.status() === 200,
  );
  await page.goto('/en/auth/login');
  expect(await (await anonymous).json()).toMatchObject({
    success: true,
    data: { authenticated: false, user: null },
  });
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await expect(
    page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
  ).toHaveCount(0);
  await testInfo.attach('healthy-anonymous', {
    body: await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true }),
    contentType: 'image/png',
  });
});

for (const locale of ['en', 'ar'] as const) {
  test.describe(`${locale} 320px session actions`, () => {
    test.use({
      appLocale: locale,
      returnPath: '/sessions',
      viewport: { width: 320, height: 844 },
      hasTouch: true,
    });
    test('keeps full actions reachable through refresh, cancel and confirmation', async ({
      page,
    }, testInfo) => {
      const cards = page.getByTestId(/^session-card-timeline-/);
      const identities = () =>
        cards.evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')).sort());
      await expect(cards).toHaveCount(2);
      const initial = await identities();
      const current = await cards
        .filter({ has: page.getByTestId('current-session-badge') })
        .getAttribute('data-testid');
      const refresh = page.getByTestId('refresh-sessions-button');
      const revoke = page.getByTestId('logout-all-sessions-button');
      await settleAnimations(page);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      for (const button of [refresh, revoke]) {
        await expect(button).toBeEnabled();
        await button.click({ trial: true });
        const rect = await button.boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
        expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      await page.screenshot({ path: testInfo.outputPath('two-sessions-320.png') });
      await refresh.focus();
      await page.keyboard.press('Tab');
      await expect(revoke).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(refresh).toBeFocused();
      for (const activation of ['keyboard', 'touch'] as const) {
        const response = page.waitForResponse(
          (item) =>
            new URL(item.url()).pathname === '/api/user/sessions' &&
            item.request().method() === 'GET',
        );
        if (activation === 'keyboard') await page.keyboard.press('Enter');
        else await refresh.tap();
        expect((await response).status()).toBe(200);
        await expect.poll(identities).toEqual(initial);
      }
      await revoke.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByTestId('revoke-all-confirm-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await page.getByTestId('cancel-logout-all').focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      expect(await identities()).toEqual(initial);
      await expect(revoke).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(revoke).toBeFocused();
      await expect.poll(identities).toEqual(initial);

      await revoke.tap();
      await expect(dialog).toBeVisible();
      const revoked = page.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === '/api/user/sessions/revoke-others' &&
          item.request().method() === 'POST',
      );
      await page.getByTestId('confirm-logout-all').tap();
      expect((await revoked).status()).toBe(200);
      await expect(dialog).toBeHidden();
      await expect.poll(identities).toEqual([current]);
      await expect(page.getByTestId('current-session-badge')).toBeVisible();
      await expect(revoke).toHaveCount(0);
      await expect(refresh).toBeEnabled();
      const refreshed = page.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === '/api/user/sessions' &&
          item.request().method() === 'GET',
      );
      await refresh.tap();
      expect((await refreshed).status()).toBe(200);
      await expect.poll(identities).toEqual([current]);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath('one-session-320.png') });
    });
  });
}
