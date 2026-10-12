import { test, expect, METHODS_PATH, PASSWORD_METHODS } from './fixtures';
import { authSelectors as s } from '../utils/selectors';

test.describe('frontend-only anonymous auth', () => {
  test('uses the public identity envelope to keep an anonymous sign-in page open', async ({
    page,
    auth,
  }) => {
    const identity = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/identity' &&
        response.request().method() === 'GET',
    );
    await auth.open('login');
    expect(await (await identity).json()).toEqual({
      success: true,
      data: { authenticated: false, user: null },
    });
    await expect(page.getByTestId(s.login.form)).toBeVisible();
  });

  test('keeps keyboard focus visible in forced colours and identifies the current language', async ({
    page,
    auth,
    appLocale,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await auth.open('login');
    const current = page.getByTestId(`language-switcher-${appLocale}`);
    await expect(current).toHaveAttribute('aria-current', 'true');
    await expect(current.locator('span')).toHaveAttribute('lang', appLocale);
    await page.getByTestId(s.login.email).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const submit = page.getByTestId(s.login.submit);
    await expect(submit).toBeFocused();
    const outline = await submit.evaluate((element) => {
      const style = getComputedStyle(element);
      return { kind: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.kind).not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);
  });

  test('preserves the locale through sign-up, sign-in and forgot-password navigation', async ({
    page,
    auth,
  }) => {
    await auth.open('login');
    await auth.activateLink(s.login.register);
    await auth.expectRoute('register');
    await expect(page.getByTestId(s.register.title)).toBeVisible();
    await auth.activateLink(s.register.login);
    await auth.expectRoute('login');
    await expect(page.getByTestId(s.login.email)).toBeFocused();
    await auth.activateLink(s.login.forgot);
    await auth.expectRoute('forgot-password');
    await expect(page.getByTestId(s.forgot.title)).toBeVisible();
    await expect(page.getByTestId(s.forgot.email)).toBeFocused();
    await auth.activateLink(s.backToLogin);
    await auth.expectRoute('login');
    await page.getByTestId(s.login.forgot).focus();
    await page.keyboard.press('Enter');
    await auth.expectRoute('forgot-password');
  });

  test('validates empty and malformed sign-in fields without a backend request', async ({
    page,
    auth,
  }) => {
    await auth.open('login');
    await page.getByTestId(s.login.submit).click();
    await auth.expectInvalid([s.login.email, s.login.password]);
    await expect(page.getByTestId(s.login.email)).toBeFocused();
    await page.getByTestId(s.login.email).fill('invalid-address');
    await page.getByTestId(s.login.password).fill('short');
    await page.getByTestId(s.login.submit).click();
    await auth.expectInvalid([s.login.email, s.login.password]);
  });

  test('validates the registration address and reaches sign-in submit by keyboard', async ({
    page,
    auth,
  }) => {
    // Registration asks for the address alone.
    await auth.open('register');
    await page.getByTestId(s.register.submit).click();
    await auth.expectInvalid([s.register.email]);
    await page.getByTestId(s.register.email).fill('invalid-address');
    await page.getByTestId(s.register.submit).click();
    await auth.expectInvalid([s.register.email]);
    // The sign-in page is the anonymous page that still has a password field.
    await auth.open('login');
    const password = page.getByTestId(s.login.password);
    await password.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(s.login.submit)).toBeFocused();
  });

  test('validates the forgot-password address and returns to sign-in by keyboard', async ({
    page,
    auth,
  }) => {
    await auth.open('forgot-password');
    await page.getByTestId(s.forgot.submit).click();
    await auth.expectInvalid([s.forgot.email]);
    await expect(page.getByTestId(s.forgot.email)).toBeFocused();
    await page.getByTestId(s.forgot.email).fill('invalid-address');
    await page.keyboard.press('Tab');
    await auth.expectInvalid([s.forgot.email]);
    await expect(page.getByTestId(s.forgot.submit)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(s.backToLogin)).toBeFocused();
    await page.keyboard.press('Enter');
    await auth.expectRoute('login');
  });

  test('redirects a reset link without an address to localized forgot-password', async ({
    auth,
  }) => {
    await auth.open('reset-password');
    await auth.expectRoute('forgot-password');
  });

  test('prefills the reset address and validates the code and password confirmation', async ({
    page,
    auth,
  }) => {
    await auth.open('reset-password', '?email=reader%2Btest%40example.com');
    await expect(page.getByTestId(s.reset.email)).toHaveValue('reader+test@example.com');
    await expect(page.getByTestId(s.reset.email)).toHaveAttribute('readonly', '');
    await expect(page.getByTestId(s.reset.code)).toBeFocused();
    await auth.activateLink(s.backToLogin);
    await auth.expectRoute('login');
    await auth.open('reset-password', '?email=reader%2Btest%40example.com');
    await page.getByTestId(s.reset.submit).click();
    await auth.expectInvalid([s.reset.code, s.reset.password, s.reset.confirmation]);
    await page.getByTestId(s.reset.code).fill('12ab');
    await expect(page.getByTestId(s.reset.code)).toHaveValue('12');
    await page.getByTestId(s.reset.code).fill('123456');
    await page.getByTestId(s.reset.password).fill('ExamplePassword1');
    await page.getByTestId(s.reset.confirmation).fill('DifferentPassword1');
    await page.getByTestId(s.reset.submit).click();
    await auth.expectInvalid([s.reset.confirmation]);
    await auth.activateLink(s.backToLogin);
    await auth.expectRoute('login');
  });

  test('shows loading followed by the empty discovery state', async ({ page, auth }) => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${METHODS_PATH}`, async (route) => {
      await ready;
      await route.fulfill({
        json: {
          ...PASSWORD_METHODS,
          data: { methods: { ...PASSWORD_METHODS.data.methods, password: false } },
        },
      });
    });
    try {
      await auth.open('login');
      await expect(page.getByTestId(s.methodsLoading)).toBeVisible();
    } finally {
      release();
    }
    await expect(page.getByTestId(s.methodsEmpty)).toBeVisible();
    await expect(page.getByTestId(s.login.form)).toHaveCount(0);
  });

  for (const [route, title, form] of [
    ['login', s.login.title, s.login.form],
    ['register', s.register.title, s.register.form],
    ['forgot-password', s.forgot.title, s.forgot.form],
    ['reset-password', s.reset.title, s.reset.form],
  ] as const) {
    test(`${route} has the expected language, direction, labels and no horizontal overflow`, async ({
      page,
      auth,
      appLocale,
    }, testInfo) => {
      await auth.open(route, route === 'reset-password' ? '?email=reader%40example.com' : '');
      await expect(page.getByTestId(title)).toBeVisible();
      await expect(page.getByTestId(form)).toHaveAccessibleName(/\S+/);
      const documentState = await page.getByTestId(s.main).evaluate(() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        width: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth,
      }));
      expect(documentState.lang).toBe(appLocale);
      expect(documentState.dir).toBe(appLocale === 'ar' ? 'rtl' : 'ltr');
      expect(documentState.contentWidth).toBeLessThanOrEqual(documentState.width + 1);
      await testInfo.attach(`${route}-page`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }
});
