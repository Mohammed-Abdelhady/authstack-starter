// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { clearBrowserProof } from '@/store/api/browser-proof';
import { setUser } from '@/modules/auth/store/authSlice';
import { ErrorCode } from '@app/core';
import {
  TEST_USER,
  codeTranslator,
  identityResponse,
  installFetch,
  jsonResponse,
  makeStore,
  panelElement,
  renderPanel,
  seedTransaction,
  transactionPayload,
  translator,
  userResponse,
} from './harness';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;

let messages: Record<(typeof LOCALES)[number], AbstractIntlMessages>;

beforeAll(async () => {
  messages = {
    en: await loadMessages('en'),
    ar: await loadMessages('ar'), // feature:locale-ar
  };
});

beforeEach(() => {
  replaceMock.mockClear();
});

afterEach(() => {
  cleanup();
  clearBrowserProof();
  vi.unstubAllGlobals();
});

function expectFocusedHeading(container: HTMLElement): void {
  expect(document.activeElement).toBe(within(container).getByRole('heading', { level: 1 }));
}

describe('NativeAuthorizePanel states', () => {
  it('reads the transaction once even though strict mode renders twice', async () => {
    const requests = installFetch(() =>
      jsonResponse({ success: true, data: transactionPayload('Acme Mobile') }),
    );
    renderPanel({ locale: 'en', messages: messages.en, store: makeStore() });

    await screen.findByTestId('native-authorize-ready');

    const reads = requests.filter((path) => path.startsWith('/api/oauth/authorize/transaction/'));
    expect(reads).toEqual(['/api/oauth/authorize/transaction/txn-abc123']);
  });

  it.each(LOCALES)('shows the confirmation card in %s and focuses its heading', async (locale) => {
    installFetch(() => jsonResponse({ success: true, data: transactionPayload('Acme Mobile') }));
    renderPanel({ locale, messages: messages[locale], store: makeStore() });

    const container = await screen.findByTestId('native-authorize-ready');
    const t = translator(locale, messages[locale]);
    expect(container.textContent).toContain(t('title', { application: 'Acme Mobile' }));
    expect(container.textContent).toContain(t('accountStatement'));
    expect(container.textContent).toContain('Layla Haddad');
    expect(container.textContent).toContain('layla@example.com');
    // The account row must not add a second heading.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expectFocusedHeading(container);
  });

  it.each(LOCALES)('shows the expired state without approve controls in %s', async (locale) => {
    installFetch(() =>
      jsonResponse(
        { success: false, error: { code: ErrorCode.NATIVE_TRANSACTION_EXPIRED, message: 'gone' } },
        404,
      ),
    );
    renderPanel({ locale, messages: messages[locale], store: makeStore() });

    const container = await screen.findByTestId('native-authorize-expired');
    const t = translator(locale, messages[locale]);
    expect(container.textContent).toContain(t('expiredTitle'));
    expect(container.textContent).toContain(t('expiredBody'));
    expect(screen.queryByTestId('native-authorize-approve')).toBeNull();
    expect(screen.queryByTestId('native-authorize-deny')).toBeNull();
    expectFocusedHeading(container);
  });

  it('treats a missing transaction as expired without a read', async () => {
    const requests = installFetch(() =>
      jsonResponse({ success: true, data: transactionPayload('Acme Mobile') }),
    );
    renderPanel({ locale: 'en', messages: messages.en, store: makeStore(), transaction: '' });

    await screen.findByTestId('native-authorize-expired');
    const reads = requests.filter((path) => path.startsWith('/api/oauth/authorize/transaction/'));
    expect(reads).toHaveLength(0);
  });

  it.each(LOCALES)('shows the existing disabled message in %s', async (locale) => {
    installFetch(() =>
      jsonResponse(
        { success: false, error: { code: ErrorCode.NATIVE_AUTH_DISABLED, message: 'off' } },
        403,
      ),
    );
    renderPanel({ locale, messages: messages[locale], store: makeStore() });

    const container = await screen.findByTestId('native-authorize-disabled');
    const tCodes = codeTranslator(locale, messages[locale]);
    expect(container.textContent).toContain(tCodes(ErrorCode.NATIVE_AUTH_DISABLED));
    expectFocusedHeading(container);
  });

  it('shows the mapped error, focuses it, and recovers on retry', async () => {
    let reads = 0;
    installFetch(() => {
      reads += 1;
      if (reads === 1) {
        return jsonResponse(
          { success: false, error: { code: 'SOMETHING_NEW', message: 'boom' } },
          500,
        );
      }
      return jsonResponse({ success: true, data: transactionPayload('Acme Mobile') });
    });
    renderPanel({ locale: 'en', messages: messages.en, store: makeStore() });

    const container = await screen.findByTestId('native-authorize-error');
    const t = translator('en', messages.en);
    expect(container.textContent).toContain(t('errorTitle'));
    expectFocusedHeading(container);

    fireEvent.click(screen.getByTestId('native-authorize-retry'));

    const ready = await screen.findByTestId('native-authorize-ready');
    expect(reads).toBe(2);
    expectFocusedHeading(ready);
  });

  it('shows the error state, not the card, when the identity fetch fails', async () => {
    installFetch(() => jsonResponse({ success: true, data: transactionPayload('Acme Mobile') }), {
      identity: 'fail',
    });
    renderPanel({ locale: 'en', messages: messages.en, store: makeStore() });

    const container = await screen.findByTestId('native-authorize-error');
    expect(container.textContent).toContain(translator('en', messages.en)('errorTitle'));
    expect(screen.queryByTestId('native-authorize-approve')).toBeNull();
  });

  it('reads identity again when Retry follows a failed read', async () => {
    let identityReads = 0;
    installFetch(() => jsonResponse({ success: true, data: transactionPayload('Acme Mobile') }), {
      identity: () => {
        identityReads += 1;
        return identityReads === 1
          ? jsonResponse(
              { success: false, error: { code: 'INTERNAL_ERROR', message: 'down' } },
              503,
            )
          : userResponse(TEST_USER);
      },
    });
    renderPanel({ locale: 'en', messages: messages.en, store: makeStore() });

    await screen.findByTestId('native-authorize-error');
    fireEvent.click(screen.getByTestId('native-authorize-retry'));

    const ready = await screen.findByTestId('native-authorize-ready');
    expect(ready.textContent).toContain('layla@example.com');
    expect(identityReads).toBe(2);
  });

  it('waits for the account before offering approval', async () => {
    installFetch(() => jsonResponse({ success: true, data: transactionPayload('Acme Mobile') }), {
      identity: 'pending',
    });
    const store = makeStore();
    await seedTransaction(store);
    renderPanel({ locale: 'en', messages: messages.en, store });

    expect(screen.getByTestId('native-authorize-loading')).toBeTruthy();
    expect(screen.queryByTestId('native-authorize-ready')).toBeNull();
    expect(screen.queryByTestId('native-authorize-approve')).toBeNull();
  });

  it('clears the auth state when identity confirms there is no session', async () => {
    const requests = installFetch(
      () =>
        jsonResponse(
          { success: false, error: { code: ErrorCode.SESSION_REQUIRED, message: 'no session' } },
          401,
        ),
      { identity: () => identityResponse(null) },
    );
    const store = makeStore();
    store.dispatch(setUser(TEST_USER));
    expect(store.getState().auth.isAuthenticated).toBe(true);

    renderPanel({ locale: 'en', messages: messages.en, store });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => expect(store.getState().auth.isAuthenticated).toBe(false));
    expect(store.getState().auth.user).toBeNull();
    expect(requests).toContain('/api/auth/identity');
  });

  it('redirects to sign-in only once even when the card re-renders', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { success: false, error: { code: ErrorCode.SESSION_REQUIRED, message: 'no session' } },
        401,
      ),
    );
    const store = makeStore();
    const { rerender } = render(panelElement({ locale: 'en', messages: messages.en, store }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledTimes(1);
    });

    rerender(panelElement({ locale: 'en', messages: messages.en, store }));
    await waitFor(() => {
      expect(screen.getByTestId('native-authorize-loading')).toBeTruthy();
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
  });
});
