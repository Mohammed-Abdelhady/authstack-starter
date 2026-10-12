import { StrictMode, type ReactElement } from 'react';
import { Provider } from 'react-redux';
import { render } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator, type AbstractIntlMessages } from 'next-intl';
import { vi } from 'vitest';
import type { AppLocale } from '@/i18n/load-messages';
import {
  makeStore as makeAppStore,
  registerFormTestLifecycle,
} from '@/tests/serverRejectionHarness';
import { authApi } from '../../store/authApi';
import { NativeAuthorizePanel } from '../NativeAuthorizePanel';
import type { Identity, User } from '@app/sdk';

export const TEST_TRANSACTION = 'txn-abc123';

export const TEST_USER: User = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false, // feature:totp
  passkeyCount: 0, // feature:passkeys
  linkedProviders: ['email'],
};

/** A second account, for the cases where the browser session changes hands. */
export const OTHER_USER: User = {
  ...TEST_USER,
  id: 'user-2',
  email: 'omar@example.com',
  name: 'Omar Nasser',
};

/** Platform value is never shown; it is part of the contract payload. */
export function transactionPayload(applicationName: string) {
  return {
    applicationName,
    platform: 'ios',
    expiresAt: '2026-10-01T12:05:00.000Z',
    alreadyGranted: false,
  };
}

registerFormTestLifecycle();

export const makeStore = makeAppStore;

export type TestStore = ReturnType<typeof makeStore>;

/** Seeds the transaction query so a test can control the account separately. */
export async function seedTransaction(store: TestStore): Promise<void> {
  await store.dispatch(
    authApi.util.upsertQueryData(
      'getNativeAuthorizeTransaction',
      TEST_TRANSACTION,
      transactionPayload('Acme Mobile'),
    ),
  );
}

/** Seeds both reads so a test can render the card without any network work. */
export async function seedReady(store: TestStore): Promise<void> {
  await seedTransaction(store);
  const identity: Identity = { authenticated: true, user: TEST_USER };
  await store.dispatch(authApi.util.upsertQueryData('getIdentity', undefined, identity));
}

interface RenderPanelOptions {
  locale: AppLocale;
  messages: AbstractIntlMessages;
  store: TestStore;
  transaction?: string;
}

export function panelElement({
  locale,
  messages,
  store,
  transaction = TEST_TRANSACTION,
}: RenderPanelOptions): ReactElement {
  return (
    <StrictMode>
      <Provider store={store}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
          <NativeAuthorizePanel transaction={transaction} />
        </NextIntlClientProvider>
      </Provider>
    </StrictMode>
  );
}

export function renderPanel(options: RenderPanelOptions): ReturnType<typeof render> {
  return render(panelElement(options));
}

/** Expected strings are resolved through the same catalogue the app ships. */
export type MessageFn = (key: string, values?: Record<string, string | number>) => string;

export function translator(locale: AppLocale, messages: AbstractIntlMessages): MessageFn {
  return createTranslator({
    locale,
    messages,
    namespace: 'auth.nativeAuthorize',
  }) as MessageFn;
}

export function codeTranslator(locale: AppLocale, messages: AbstractIntlMessages): MessageFn {
  return createTranslator({ locale, messages, namespace: 'errors.codes' }) as MessageFn;
}

export type FetchHandler = (request: Request) => Response | Promise<Response>;

export type IdentityMode = 'ok' | 'pending' | 'fail';

export interface FetchOptions {
  /**
   * How the identity endpoint answers; defaults to a signed-in account. A
   * handler lets one test change the answer between requests.
   */
  identity?: IdentityMode | FetchHandler;
}

const IDENTITY_PATH = '/api/auth/identity';

/**
 * Stubs the network boundary and records the path each request asked for.
 * The identity endpoint is answered here so every test starts from the same
 * signed-in account unless it says otherwise.
 */
export function installFetch(handler: FetchHandler, options: FetchOptions = {}): string[] {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    requests.push(pathname);

    if (pathname === IDENTITY_PATH) {
      if (typeof options.identity === 'function') {
        return options.identity(request);
      }
      if (options.identity === 'pending') {
        return new Promise<Response>(() => {});
      }
      if (options.identity === 'fail') {
        return jsonResponse(
          { success: false, error: { code: 'INTERNAL_ERROR', message: 'identity failed' } },
          500,
        );
      }
      return identityResponse(TEST_USER);
    }

    return handler(request);
  });
  return requests;
}

/** A refusal in the envelope the API answers with. */
export function errorResponse(code: string, status: number): Response {
  return jsonResponse({ success: false, error: { code, message: code } }, status);
}

export function userResponse(user: User): Response {
  return identityResponse(user);
}

export function identityResponse(user: User | null): Response {
  return jsonResponse({
    success: true,
    data: user ? { authenticated: true, user } : { authenticated: false, user: null },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
