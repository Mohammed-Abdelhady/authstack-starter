import { test, expect, API } from './fixtures/authenticated';

test.use({ authenticate: false });

test.describe('Local OAuth application integration', () => {
  test('consent creates a real session and returns to the requested page', async ({ page }) => {
    await page.goto('/en/auth/login?redirect=%2Fsessions');
    await page.getByTestId('oauth-google-button').click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:5108\/authorize/);
    await page.getByTestId('consent-continue').click();
    await expect(page).toHaveURL('http://127.0.0.1:3107/en/sessions');
    await expect(page.getByTestId('sessions-page')).toBeVisible();
    expect((await (await page.request.get(`${API}/user/profile`)).json()).data.email).toBe(
      'oauth@example.test',
    );
  });

  for (const outcome of ['cancel', 'error'] as const) {
    test(`${outcome} shows a recoverable callback error without a session`, async ({ page }) => {
      await page.goto('/en/auth/login');
      await page.getByTestId('oauth-google-button').click();
      await page.getByTestId(`consent-${outcome}`).click();
      await expect(page.getByTestId('oauth-callback-error')).toBeVisible();
      expect((await page.request.get(`${API}/user/profile`)).status()).toBe(401);
      await page.getByTestId('oauth-back-to-sign-in').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('login-submit')).toBeVisible();
    });
  }
});

test.describe('Captured magic-link mail', () => {
  test('asks before a forwarded link signs in another browser', async ({
    page,
    browser,
    fixtureMail,
  }) => {
    await page.goto('/en/auth/login');
    await page.getByTestId('magic-link-email-input').fill('user@seed.local');
    await page.getByTestId('magic-link-submit').click();
    await expect(page.getByTestId('magic-link-sent')).toBeVisible();
    let link = '';
    await expect
      .poll(async () => {
        link =
          (await fixtureMail())
            .findLast((mail) => mail.to === 'user@seed.local')
            ?.text?.match(/http:\/\/127\.0\.0\.1:3107\S+/)?.[0] ?? '';
        return link;
      })
      .not.toBe('');

    const forwarded = await browser.newContext();
    try {
      const reader = await forwarded.newPage();
      await reader.goto(link);
      await expect(reader.getByTestId('magic-link-verify-confirmation')).toBeVisible();
      expect((await reader.request.get(`${API}/user/profile`)).status()).toBe(401);
      await reader.getByTestId('magic-link-confirm-forwarded').click();
      await expect(reader).toHaveURL('http://127.0.0.1:3107/en/dashboard');
      expect((await (await reader.request.get(`${API}/user/profile`)).json()).data.email).toBe(
        'user@seed.local',
      );
    } finally {
      await forwarded.close();
    }
  });

  for (const expired of [false, true]) {
    test(`${expired ? 'expired' : 'valid'} link has the expected user outcome`, async ({
      page,
      fixtureMail,
      expireMagicLinks,
    }, info) => {
      // Verification can start before this new page's optional identity read completes.
      info.annotations.push({
        type: 'expected-api-error',
        description: JSON.stringify({ path: '/api/auth/csrf', status: 401 }),
      });
      let csrfProbes = 0;
      let verificationWrites = 0;
      page.on('response', (response) => {
        if (new URL(response.url()).pathname === '/api/auth/csrf' && response.status() === 401)
          csrfProbes++;
      });
      page.on('request', (request) => {
        if (
          new URL(request.url()).pathname === '/api/auth/magic-link/verify' &&
          request.method() === 'POST'
        )
          verificationWrites++;
      });
      if (expired) {
        info.annotations.push({
          type: 'expected-api-error',
          description: JSON.stringify({ path: '/api/auth/magic-link/verify', status: 400 }),
        });
      }
      const identity = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/auth/identity' && response.status() === 200,
      );
      await page.goto('/en/auth/login');
      await identity;
      await page.getByTestId('magic-link-email-input').fill('user@seed.local');
      await page.getByTestId('magic-link-submit').click();
      await expect(page.getByTestId('magic-link-sent')).toBeVisible();
      let link = '';
      await expect
        .poll(async () => {
          link =
            (await fixtureMail())
              .findLast((mail) => mail.to === 'user@seed.local')
              ?.text?.match(/http:\/\/127\.0\.0\.1:3107\S+/)?.[0] ?? '';
          return link;
        })
        .not.toBe('');
      if (expired) await expireMagicLinks();
      await page.goto(link);
      if (expired) {
        await expect(page.getByTestId('magic-link-verify-error')).toBeVisible();
        expect((await page.request.get(`${API}/user/profile`)).status()).toBe(401);
        await page.getByTestId('magic-link-request-new').click();
        await expect(page.getByTestId('magic-link-email-input')).toBeVisible();
      } else {
        await expect(page).toHaveURL('http://127.0.0.1:3107/en/dashboard');
        expect((await (await page.request.get(`${API}/user/profile`)).json()).data.email).toBe(
          'user@seed.local',
        );
      }
      expect(csrfProbes).toBe(1);
      expect(verificationWrites).toBe(1);
    });
  }
});
