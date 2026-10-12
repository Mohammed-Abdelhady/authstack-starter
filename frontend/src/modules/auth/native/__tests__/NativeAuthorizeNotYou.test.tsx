// @vitest-environment jsdom
import { availability, HELD } from '@/tests/busyControls';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import {
  TEST_TRANSACTION,
  installFetch,
  jsonResponse,
  makeStore,
  renderPanel,
  seedReady,
  transactionPayload,
  translator,
  type TestStore,
} from './harness';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const LOGOUT_PATH = '/api/auth/logout';

let messages: AbstractIntlMessages;

beforeAll(async () => {
  messages = await loadMessages('en');
});

beforeEach(() => {
  replaceMock.mockClear();
  rememberBrowserProof('session-proof', 'session');
});

afterEach(() => {
  cleanup();
  clearBrowserProof();
  vi.unstubAllGlobals();
});

function readResponse(): Response {
  return jsonResponse({ success: true, data: transactionPayload('Acme Mobile') });
}

async function renderReady(store: TestStore) {
  await seedReady(store);
  const view = renderPanel({ locale: 'en', messages, store });
  await screen.findByTestId('native-authorize-ready');
  return view;
}

describe('NativeAuthorizePanel "Not you?"', () => {
  it('calls logout exactly once and returns to sign-in', async () => {
    const posts: string[] = [];
    installFetch(async (request) => {
      if (request.method === 'POST') {
        posts.push(new URL(request.url).pathname);
        return jsonResponse({ success: true, data: { message: 'ok' } });
      }
      return readResponse();
    });
    await renderReady(makeStore());

    const button = screen.getByTestId('native-authorize-not-you');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(posts).toEqual([LOGOUT_PATH]);
    const continuation = encodeURIComponent(
      `/auth/native/authorize?transaction=${TEST_TRANSACTION}`,
    );
    expect(replaceMock).toHaveBeenCalledWith(`/auth/login?redirect=${continuation}`);
  });

  it('holds every control while the logout is pending', async () => {
    let resolveLogout: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveLogout = resolve;
    });
    installFetch((request) => (request.method === 'POST' ? pending : readResponse()));
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-not-you'));

    expect(availability(screen.getByTestId('native-authorize-not-you'))).toEqual(HELD);
    expect(availability(screen.getByTestId('native-authorize-approve'))).toEqual(HELD);
    expect(availability(screen.getByTestId('native-authorize-deny'))).toEqual(HELD);
    expect(screen.getByTestId('native-authorize-status').textContent).toBe(
      translator('en', messages)('signingOut'),
    );

    await act(async () => {
      resolveLogout?.(jsonResponse({ success: true, data: { message: 'ok' } }));
    });
  });

  it('shows the error state when logout fails', async () => {
    installFetch((request) => {
      if (request.method === 'POST') {
        return jsonResponse(
          { success: false, error: { code: 'SOMETHING_NEW', message: 'boom' } },
          500,
        );
      }
      return readResponse();
    });
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-not-you'));

    await screen.findByTestId('native-authorize-error');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
