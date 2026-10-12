import { test as base, expect } from '@playwright/test';
import { AnonymousAuthActions, type AppLocale } from '../utils/auth-actions';

export interface AnonymousOptions {
  appLocale: AppLocale;
}

interface AnonymousFixtures {
  auth: AnonymousAuthActions;
  auditBrowser: void;
}

const IDENTITY_PATH = '/api/auth/identity';
export const METHODS_PATH = '/api/auth/methods';
export const PASSWORD_METHODS = {
  success: true,
  data: {
    methods: { password: true, magicLink: false, twoFactor: false, passkeys: false, oauth: [] },
  },
};

export const test = base.extend<AnonymousOptions & AnonymousFixtures>({
  appLocale: ['en', { option: true }],
  auth: async ({ page, appLocale, hasTouch }, run) => {
    await run(new AnonymousAuthActions(page, appLocale, hasTouch));
  },
  auditBrowser: [
    async ({ page }, run, testInfo) => {
      const errors: string[] = [];
      const identityReads: string[] = [];
      const consoleErrors: { url: string; text: string }[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push({ url: message.location().url, text: message.text() });
        }
      });
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === METHODS_PATH && request.method() === 'GET') {
          await route.fulfill({ json: PASSWORD_METHODS });
          return;
        }
        if (path === IDENTITY_PATH && request.method() === 'GET') {
          identityReads.push('GET /api/auth/identity');
          await route.fulfill({
            json: { success: true, data: { authenticated: false, user: null } },
          });
          return;
        }
        errors.push(`Unexpected API request: ${request.method()} ${path}`);
        await route.abort('blockedbyclient');
      });
      await run();
      await testInfo.attach('browser-audit', {
        body: JSON.stringify({ errors, consoleErrors, identityReads }, null, 2),
        contentType: 'application/json',
      });
      expect(errors, 'Unexpected runtime errors or backend requests').toEqual([]);
      expect(consoleErrors, 'Unexpected browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
