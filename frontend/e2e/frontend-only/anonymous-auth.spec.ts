import { test, expect, METHODS_PATH, PASSWORD_METHODS } from './fixtures';
import { authSelectors as s } from '../utils/selectors';

test.describe('frontend-only anonymous auth', () => {
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
});
