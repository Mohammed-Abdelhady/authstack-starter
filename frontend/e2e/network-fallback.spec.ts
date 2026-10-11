import { test, expect } from './fixtures/authenticated';
import { settleAnimations } from './utils/accessibility';

const messages = {
  en: 'Network error. Please check your connection',
  ar: 'خطأ في الشبكة. يرجى التحقق من اتصالك',
};

/** The toast region is named in the page's language. */
const toastRegions = {
  en: 'Notifications',
  ar: 'الإشعارات',
};

test.use({ authenticate: false });
for (const locale of ['en', 'ar'] as const) {
  test(`${locale} actual refused connection renders a localized fallback and follows locale changes`, async ({
    page,
    apiAvailability,
  }, info) => {
    await page.goto(`/${locale}/auth/login`);
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    for (const path of ['/api/user/profile', '/api/auth/methods', '/api/auth/oauth/providers'])
      info.annotations.push({ type: 'expected-network-error', description: path });
    await apiAvailability(false);
    try {
      await page.reload();
      const notifications = page.getByRole('region', { name: toastRegions[locale] });
      await expect(notifications.getByRole('listitem').first()).toContainText(messages[locale]);
      await expect(notifications).not.toContainText('toast.error');
      await expect(notifications).not.toContainText('getCurrentUser');
      await settleAnimations(page);
      await info.attach(`${locale}-network-fallback`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      const other = locale === 'en' ? 'ar' : 'en';
      await page.getByTestId(`language-switcher-${other}`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', other);
      await expect(page.locator('html')).toHaveAttribute('dir', other === 'ar' ? 'rtl' : 'ltr');
      const translated = page.getByRole('region', { name: toastRegions[other] });
      await expect(translated.getByRole('listitem').first()).toContainText(messages[other]);
      await settleAnimations(page);
      await info.attach(`${locale}-to-${other}-network-fallback`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await apiAvailability(true);
    }
    await page.reload();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });
}
