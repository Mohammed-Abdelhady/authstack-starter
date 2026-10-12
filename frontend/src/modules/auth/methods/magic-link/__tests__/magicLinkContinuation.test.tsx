// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Provider } from 'react-redux';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import {
  makeStore,
  registerFormTestLifecycle,
  refusalWith,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import type { SignedInUser } from '@/modules/auth/types/auth.types';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { MagicLinkRequestForm } from '../MagicLinkRequestForm';
import { MagicLinkVerifyPanel } from '../MagicLinkVerifyPanel';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  Link: () => null,
}));

/** Hand-written continuation the server is expected to store and echo back. */
const NATIVE_ROUTE = '/auth/native/authorize?transaction=txn-abc123';

const USER: SignedInUser = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

let messages: AbstractIntlMessages;

beforeAll(async () => {
  messages = await loadMessages('en');
});

beforeEach(() => {
  replaceMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

registerFormTestLifecycle();

function renderWithIntl(node: ReactElement, store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    </Provider>,
  );
}

describe('magic link continuation', () => {
  async function submitRequest(redirect: string | null): Promise<unknown> {
    let body: unknown;
    const requests = stubNetwork(async (request, path) => {
      if (path !== '/api/auth/magic-link/request') throw new Error(`Unexpected path: ${path}`);
      body = await request.json();
      return success({ email: 'layla@example.com' });
    });

    renderWithIntl(<MagicLinkRequestForm redirect={redirect} isOnlyMethod={false} />, makeStore());

    fireEvent.change(screen.getByTestId('magic-link-email-input'), {
      target: { value: 'layla@example.com' },
    });
    fireEvent.submit(screen.getByTestId('magic-link-form'));

    await waitFor(() => {
      expect(body).toBeDefined();
    });
    expect(requests.allRequests).toEqual([
      'GET /api/auth/csrf',
      'GET /api/auth/browser-proof',
      'POST /api/auth/magic-link/request',
    ]);
    return body;
  }

  it('sends the validated native continuation with a magic link request', async () => {
    expect(await submitRequest(NATIVE_ROUTE)).toEqual({
      email: 'layla@example.com',
      redirect: NATIVE_ROUTE,
    });
  });

  it('normalises a locale prefix before sending the continuation', async () => {
    expect(await submitRequest(`/en${NATIVE_ROUTE}`)).toEqual({
      email: 'layla@example.com',
      redirect: NATIVE_ROUTE,
    });
  });

  it.each([
    ['an ordinary path', '/dashboard'],
    ['an off-site address', 'https://evil.com/steal'],
    ['a native route without a transaction', '/auth/native/authorize'],
  ])('omits %s', async (_label, redirect) => {
    expect(await submitRequest(redirect)).toEqual({ email: 'layla@example.com' });
  });

  it('omits the redirect when none was requested', async () => {
    expect(await submitRequest(null)).toEqual({ email: 'layla@example.com' });
  });

  it('follows the continuation the verify step returns', async () => {
    const requests = stubNetwork((_, path) => {
      if (path !== '/api/auth/magic-link/verify') throw new Error(`Unexpected path: ${path}`);
      return success({ requiresTwoFactor: false, user: USER, redirect: NATIVE_ROUTE });
    });

    renderWithIntl(<MagicLinkVerifyPanel token="link-token" redirect={null} />, makeStore());

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(NATIVE_ROUTE);
    });
    expect(requests.allRequests).toEqual([
      'GET /api/auth/csrf',
      'GET /api/auth/browser-proof',
      'POST /api/auth/magic-link/verify',
    ]);
  });

  it('asks before switching accounts and completes sign-in only after confirmation', async () => {
    const bodies: unknown[] = [];
    const requests = stubNetwork(async (request, path) => {
      if (path !== '/api/auth/magic-link/verify') throw new Error(`Unexpected path: ${path}`);
      bodies.push(await request.json());
      if (bodies.length === 1) {
        return success({ requiresConfirmation: true, email: 'u***@example.test' });
      }
      return success({ requiresTwoFactor: false, user: USER, redirect: NATIVE_ROUTE });
    });
    const store = makeStore();
    store.dispatch(loginFulfilled({ ...USER, email: 'current@example.com' }));

    renderWithIntl(<MagicLinkVerifyPanel token="link-token" redirect={null} />, store);

    const confirmation = await screen.findByTestId('magic-link-verify-confirmation');
    expect(confirmation.textContent).toContain('u***@example.test');
    expect(screen.getByTestId('magic-link-current-account').textContent).toContain(
      'current@example.com',
    );
    const status = screen.getByRole('status');
    expect(status.contains(screen.getByTestId('magic-link-confirm-forwarded'))).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(bodies).toEqual([{ token: 'link-token' }]);
    expect(store.getState().auth.user?.email).toBe('current@example.com');
    expect(requests.allRequests).toEqual([
      'GET /api/auth/csrf',
      'GET /api/auth/browser-proof',
      'POST /api/auth/magic-link/verify',
    ]);

    fireEvent.click(screen.getByTestId('magic-link-confirm-forwarded'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(NATIVE_ROUTE));
    expect(store.getState().auth.user?.email).toBe('current@example.com');
    expect(bodies).toEqual([{ token: 'link-token' }, { token: 'link-token', confirm: true }]);
    expect(
      requests.filter((request) => request === 'POST /api/auth/magic-link/verify'),
    ).toHaveLength(2);
  });

  it('does not complete sign-in when the explicit confirmation request is refused', async () => {
    let verifications = 0;
    const requests = stubNetwork((request, path) => {
      if (path !== '/api/auth/magic-link/verify') throw new Error(`Unexpected path: ${path}`);
      verifications += 1;
      if (verifications === 1) {
        return success({ requiresConfirmation: true, email: 'u***@example.test' });
      }
      return refusalWith(410, 'MAGIC_LINK_INVALID');
    });
    const store = makeStore();
    renderWithIntl(<MagicLinkVerifyPanel token="link-token" redirect={null} />, store);

    fireEvent.click(await screen.findByTestId('magic-link-confirm-forwarded'));

    await screen.findByTestId('magic-link-verify-error');
    expect(replaceMock).not.toHaveBeenCalled();
    expect(store.getState().auth.user).toBeNull();
    expect(
      requests.filter((request) => request === 'POST /api/auth/magic-link/verify'),
    ).toHaveLength(2);
  });

  it('rejects an off-site continuation returned by the verify step', async () => {
    stubNetwork((_, path) => {
      if (path !== '/api/auth/magic-link/verify') throw new Error(`Unexpected path: ${path}`);
      return success({ requiresTwoFactor: false, user: USER, redirect: 'https://evil.com/steal' });
    });

    renderWithIntl(<MagicLinkVerifyPanel token="link-token" redirect={null} />, makeStore());

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('asks the window for no frame when the form is unmounted after a request', async () => {
    const frames = vi.spyOn(window, 'requestAnimationFrame');

    await submitRequest(null);
    cleanup();

    expect(frames).not.toHaveBeenCalled();
  });
});
