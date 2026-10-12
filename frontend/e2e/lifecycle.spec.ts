import { auditAccessibility } from './utils/accessibility';
import { test, expect, API, type FixtureMail } from './fixtures/authenticated';
import { message } from './utils/messages';
import { authSelectors as auth } from './utils/selectors';

/** The label of the read-only address on the profile card. */
const PROFILE_EMAIL_LABEL = 'settings.profile.email';

async function mailCode(
  read: () => Promise<FixtureMail[]>,
  email: string,
  subject: string,
): Promise<string> {
  let code = '';
  await expect
    .poll(async () => {
      const mail = (await read()).findLast((item) => item.to === email && item.subject === subject);
      code = mail?.text?.match(/\b\d{6}\b/)?.[0] ?? '';
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code;
}

for (const locale of ['en', 'ar'] as const) {
  for (const mobile of [false, true]) {
    test.describe(`${locale} ${mobile ? 'mobile' : 'desktop'} lifecycle`, () => {
      test.use({
        authenticate: false,
        appLocale: locale,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        isMobile: mobile,
        hasTouch: mobile,
      });

      test('register, activate, update profile, reload and sign out', async ({
        page,
        fixtureMail,
      }, info) => {
        const email = 'lifecycle@example.test';
        await page.goto(`/${locale}/auth/login`);
        await expect(page.getByTestId(auth.login.submit)).toBeVisible();
        await auditAccessibility(page, info, 'login');
        await page.getByTestId(auth.login.register).click();
        // Registration asks for the address alone. The code screen takes the rest.
        await page.getByTestId(auth.register.email).fill(email);
        await page.getByTestId(auth.register.submit).click();
        await expect(page.getByTestId(auth.activate.form)).toBeVisible();
        await auditAccessibility(page, info, 'activate');
        await page
          .getByTestId(auth.activate.code)
          .fill(await mailCode(fixtureMail, email, 'Verify Your Email Address'));
        await page.getByTestId(auth.activate.name).fill('Lifecycle User');
        await page.getByTestId(auth.activate.password).fill('Lifecycle123!');
        await page.getByTestId(auth.activate.confirmation).fill('Lifecycle123!');
        await page.getByTestId(auth.activate.submit).click();
        // Activation signs the person in and goes straight to the dashboard.
        await expect(page).toHaveURL(`http://127.0.0.1:3107/${locale}/dashboard`);
        const profile = await page.request.get(`${API}/user/profile`);
        expect((await profile.json()).data).toMatchObject({ email, name: 'Lifecycle User' });
        await page.goto(`/${locale}/settings`);
        await expect(page.getByTestId('profile-name-input')).toHaveValue('Lifecycle User');
        await expect(page.getByTestId('profile-email-input')).toHaveAccessibleName(
          message(locale, PROFILE_EMAIL_LABEL),
        );
        await auditAccessibility(page, info, 'settings');
        await page.getByTestId('profile-name-input').fill('Updated Lifecycle');
        const updated = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/user/profile') && response.request().method() === 'PATCH',
        );
        await page.getByTestId('update-profile-submit').click();
        expect((await updated).status()).toBe(200);
        await page.reload();
        await expect(page.getByTestId('profile-name-input')).toHaveValue('Updated Lifecycle');
        expect((await (await page.request.get(`${API}/user/profile`)).json()).data.name).toBe(
          'Updated Lifecycle',
        );
        expect(await page.locator('html').getAttribute('dir')).toBe(
          locale === 'ar' ? 'rtl' : 'ltr',
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await info.attach('settings-page', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
        await page.getByTestId('logout-button').click();
        await expect(page).toHaveURL(`http://127.0.0.1:3107/${locale}/auth/login`);
        expect((await page.request.get(`${API}/user/profile`)).status()).toBe(401);
        await page.goto(`/${locale}/settings`);
        await expect(page.getByTestId(auth.login.submit)).toBeVisible();
      });

      test('reset password through captured mail and sign in with the replacement', async ({
        page,
        fixtureMail,
      }) => {
        const email = 'user@seed.local';
        await page.goto(`/${locale}/auth/login`);
        await page.getByTestId(auth.login.forgot).click();
        await page.getByTestId(auth.forgot.email).fill(email);
        await page.getByTestId(auth.forgot.submit).click();
        await expect(page.getByTestId(auth.reset.form)).toBeVisible();
        await page
          .getByTestId(auth.reset.code)
          .fill(await mailCode(fixtureMail, email, 'Reset Your Password'));
        await page.getByTestId(auth.reset.password).fill('Replacement123!');
        await page.getByTestId(auth.reset.confirmation).fill('Replacement123!');
        await page.getByTestId(auth.reset.submit).click();
        await expect(page.getByTestId(auth.login.submit)).toBeVisible();
        await page.getByTestId(auth.login.email).fill(email);
        await page.getByTestId(auth.login.password).fill('Replacement123!');
        await page.getByTestId(auth.login.submit).click();
        await expect(page).toHaveURL(`http://127.0.0.1:3107/${locale}/dashboard`);
        expect((await (await page.request.get(`${API}/user/profile`)).json()).data.email).toBe(
          email,
        );
      });
    });
  }
}
