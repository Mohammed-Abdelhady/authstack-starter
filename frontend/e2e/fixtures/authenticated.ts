import {
  test as base,
  expect,
  type Page,
  type ConsoleMessage,
  type Response,
} from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { CSRF_HEADER, publicBrowserProof, sessionBrowserProof } from '../utils/browser-proof';

const backendDirectory = resolve(__dirname, '../../../backend');
export const API = 'http://127.0.0.1:5107/api';
export const admin = { email: 'admin@seed.local', password: 'Admin123!' };

function receive(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Fixture timed out waiting for ${expected}`)),
      60000,
    );
    const message = (value: unknown) => {
      if (value === expected) finish();
    };
    const exit = (code: number | null) => finish(new Error(`Fixture exited with ${code}`));
    function finish(error?: Error): void {
      clearTimeout(timeout);
      child.off('message', message);
      child.off('exit', exit);
      if (error) reject(error);
      else resolvePromise();
    }
    child.on('message', message);
    child.once('exit', exit);
  });
}

export interface FixtureMail {
  to: string;
  subject: string;
  text?: string;
}

function readMail(child: ChildProcess): Promise<FixtureMail[]> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => finish(new Error('Fixture mail timed out')), 10000);
    const message = (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'mail' &&
        'messages' in value
      )
        finish(undefined, value.messages as FixtureMail[]);
    };
    const exit = () => finish(new Error('Fixture exited while reading mail'));
    function finish(error?: Error, mail: FixtureMail[] = []): void {
      clearTimeout(timeout);
      child.off('message', message);
      child.off('exit', exit);
      if (error) reject(error);
      else resolvePromise(mail);
    }
    child.on('message', message);
    child.once('exit', exit);
    child.send('mail');
  });
}

export const test = base.extend<
  {
    signedIn: void;
    authenticate: boolean;
    fixtureMail: () => Promise<FixtureMail[]>;
    expireMagicLinks: () => Promise<void>;
    apiAvailability: (enabled: boolean) => Promise<void>;
    browserAudit: (page: Page) => void;
    appLocale: 'en' | 'ar';
    actor: { email: string; password: string };
    returnPath: string;
  },
  { backend: ChildProcess }
>({
  authenticate: [true, { option: true }],
  apiAvailability: async ({ backend }, run) => {
    await run(async (enabled) => {
      const acknowledged = receive(backend, enabled ? 'http-resumed' : 'http-paused');
      backend.send(enabled ? 'resume-http' : 'pause-http');
      await acknowledged;
    });
  },
  fixtureMail: async ({ backend }, run) => {
    await run(() => readMail(backend));
  },
  expireMagicLinks: async ({ backend }, run) => {
    await run(async () => {
      const expired = receive(backend, 'expired-magic-links');
      backend.send('expire-magic-links');
      await expired;
    });
  },
  appLocale: ['en', { option: true }],
  actor: [admin, { option: true }],
  returnPath: ['', { option: true }],
  browserAudit: [
    async ({ page }, run, testInfo) => {
      const runtime: string[] = [];
      const consoleErrors: { url: string; text: string }[] = [];
      const responses: { path: string; status: number }[] = [];
      const watched = new WeakSet<Page>();
      const release: (() => void)[] = [];
      const auditPage = (audited: Page): void => {
        if (watched.has(audited)) return;
        watched.add(audited);
        const onError = (error: Error) => runtime.push(error.message);
        const onConsole = (message: ConsoleMessage) => {
          if (message.type() === 'error')
            consoleErrors.push({ url: message.location().url, text: message.text() });
        };
        const onResponse = (response: Response) => {
          if (response.status() >= 400)
            responses.push({ path: new URL(response.url()).pathname, status: response.status() });
        };
        audited.on('pageerror', onError);
        audited.on('console', onConsole);
        audited.on('response', onResponse);
        release.push(() => {
          audited.off('pageerror', onError);
          audited.off('console', onConsole);
          audited.off('response', onResponse);
        });
      };
      auditPage(page);
      try {
        await run(auditPage);
      } finally {
        release.forEach((stop) => stop());
      }
      const expected = [
        ...testInfo.annotations
          .filter((item) => item.type === 'expected-api-error')
          .map((item) => JSON.parse(item.description!) as { path: string; status: number }),
      ];
      await testInfo.attach('browser-audit', {
        body: JSON.stringify({ runtime, consoleErrors, responses }),
        contentType: 'application/json',
      });
      expect(runtime, 'Unexpected browser runtime errors').toEqual([]);
      expect(
        responses.filter(
          (response) =>
            !expected.some(
              (item) => item.path === response.path && item.status === response.status,
            ),
        ),
        'Unexpected failed HTTP responses',
      ).toEqual([]);
      expect(
        consoleErrors.filter(
          (error) =>
            !expected.some(
              (item) =>
                new URL(error.url || 'http://fixture.invalid').pathname === item.path &&
                error.text.includes(String(item.status)),
            ) &&
            !testInfo.annotations.some(
              (item) =>
                item.type === 'expected-network-error' &&
                new URL(error.url || 'http://fixture.invalid').pathname === item.description! &&
                error.text.includes('net::ERR_CONNECTION_REFUSED'),
            ),
        ),
        'Unexpected browser console errors',
      ).toEqual([]);
    },
    { auto: true },
  ],
  backend: [
    async ({}, run, workerInfo) => {
      const child = fork(resolve(backendDirectory, 'test/utils/browser/browser-server.ts'), [], {
        cwd: backendDirectory,
        execArgv: ['--require', 'ts-node/register'],
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          TS_NODE_PROJECT: resolve(backendDirectory, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const logs: string[] = [];
      child.stdout?.on('data', (data: Buffer) => logs.push(data.toString()));
      child.stderr?.on('data', (data: Buffer) => logs.push(data.toString()));
      try {
        await receive(child, 'ready');
        await run(child);
      } finally {
        if (child.exitCode === null) {
          const stopped = new Promise<void>((resolvePromise, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Owned backend did not stop within 10 seconds')),
              10000,
            );
            child.once('exit', () => {
              clearTimeout(timeout);
              resolvePromise();
            });
          });
          child.kill('SIGTERM');
          await stopped;
        }
        const { writeFile, mkdir } = await import('node:fs/promises');
        await mkdir(workerInfo.project.outputDir, { recursive: true });
        await writeFile(resolve(workerInfo.project.outputDir, 'backend.log'), logs.join(''));
      }
    },
    { scope: 'worker' },
  ],
  signedIn: [
    async (
      { backend, page, request, appLocale, actor, returnPath, authenticate },
      run,
      testInfo,
    ) => {
      const reset = receive(backend, 'reset');
      backend.send('reset');
      await reset;
      if (!authenticate) {
        await run();
        return;
      }
      const other = await request.post(`${API}/auth/login`, {
        headers: { [CSRF_HEADER]: await publicBrowserProof(request, API) },
        data: { email: actor.email, password: actor.password },
      });
      expect(other.status()).toBe(200);
      await request.dispose();
      await page.goto(
        `/${appLocale}/auth/login${returnPath ? `?redirect=${encodeURIComponent(returnPath)}` : ''}`,
      );
      await page.getByTestId('login-email-input').fill(actor.email);
      await page.getByTestId('login-password-input').fill(actor.password);
      await page.getByTestId('login-submit').click();
      const landing =
        returnPath || (actor.email === admin.email ? '/admin/dashboard' : '/dashboard');
      await expect(page).toHaveURL(`http://127.0.0.1:3107/${appLocale}${landing}`);
      await expect(page.getByTestId('dashboard-main')).toBeVisible();
      if (actor.email === admin.email) {
        const role = await page.request.post(`${API}/roles`, {
          headers: { [CSRF_HEADER]: await sessionBrowserProof(page.request, API) },
          data: {
            name: 'Fixture Editor',
            permissions: ['users:read:all'],
            description: 'Disposable custom role',
          },
        });
        expect(role.status()).toBe(201);
      }
      try {
        await run();
      } finally {
        await testInfo.attach('persisted-auth-shape', {
          body: JSON.stringify(
            await page.evaluate(() => {
              const raw = localStorage.getItem('persist:auth');
              if (!raw) return null;
              const entries = JSON.parse(raw) as Record<string, string>;
              return Object.fromEntries(
                Object.entries(entries).map(([key, value]) => {
                  const parsed: unknown = JSON.parse(value);
                  return [
                    key,
                    {
                      type: typeof parsed,
                      keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
                    },
                  ];
                }),
              );
            }),
          ),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});

export { expect };
