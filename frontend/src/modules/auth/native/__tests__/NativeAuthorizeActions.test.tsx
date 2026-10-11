// @vitest-environment jsdom
import { availability, HELD } from '@/tests/busyControls';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { ErrorCode } from '@app/core';
import { clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import {
  installFetch,
  jsonResponse,
  makeStore,
  renderPanel,
  seedReady,
  transactionPayload,
  translator,
  type TestStore,
} from './harness';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

let messages: AbstractIntlMessages;
let assignMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  messages = await loadMessages('en');
});

beforeEach(() => {
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  });
  rememberBrowserProof('session-proof', 'session');
});

afterEach(() => {
  cleanup();
  clearBrowserProof();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function readResponse(): Response {
  return jsonResponse({ success: true, data: transactionPayload('Acme Mobile') });
}

async function renderReady(store: TestStore) {
  await seedReady(store);
  return renderPanel({ locale: 'en', messages, store });
}

describe('NativeAuthorizePanel actions', () => {
  it('holds every control and announces progress while approving', async () => {
    let resolveApprove: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveApprove = resolve;
    });
    installFetch((request) => (request.method === 'POST' ? pending : readResponse()));
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    expect(availability(screen.getByTestId('native-authorize-approve'))).toEqual(HELD);
    expect(availability(screen.getByTestId('native-authorize-deny'))).toEqual(HELD);
    expect(availability(screen.getByTestId('native-authorize-not-you'))).toEqual(HELD);
    expect(screen.getByTestId('native-authorize-approve').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('native-authorize-deny').getAttribute('aria-busy')).toBe('false');
    expect(screen.getByTestId('native-authorize-status').textContent).toBe(
      translator('en', messages)('approving'),
    );

    await act(async () => {
      resolveApprove?.(jsonResponse({ success: true, data: { redirectUri: 'myapp://done' } }));
    });
    expect(assignMock).toHaveBeenCalledWith('myapp://done');
  });

  it('announces the deny action and holds the others', async () => {
    let resolveDeny: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveDeny = resolve;
    });
    installFetch((request) => (request.method === 'POST' ? pending : readResponse()));
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-deny'));

    expect(screen.getByTestId('native-authorize-status').textContent).toBe(
      translator('en', messages)('denying'),
    );
    expect(availability(screen.getByTestId('native-authorize-deny'))).toEqual(HELD);
    expect(availability(screen.getByTestId('native-authorize-approve'))).toEqual(HELD);
    expect(screen.getByTestId('native-authorize-deny').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('native-authorize-approve').getAttribute('aria-busy')).toBe('false');

    await act(async () => {
      resolveDeny?.(
        jsonResponse({ success: true, data: { redirectUri: 'myapp://done?error=access_denied' } }),
      );
    });
  });

  it('calls approve exactly once on a double click', async () => {
    const posts: string[] = [];
    const bodies: unknown[] = [];
    installFetch(async (request) => {
      if (request.method === 'POST') {
        posts.push(new URL(request.url).pathname);
        bodies.push(await request.json());
        return jsonResponse({ success: true, data: { redirectUri: 'myapp://done' } });
      }
      return readResponse();
    });
    await renderReady(makeStore());

    const button = screen.getByTestId('native-authorize-approve');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await screen.findByTestId('native-authorize-returning');
    expect(posts).toEqual(['/api/oauth/authorize/approve']);
    expect(bodies).toEqual([{ transactionId: 'txn-abc123', expectedUserId: 'user-1' }]);
  });

  it('calls deny exactly once on a double click', async () => {
    const posts: string[] = [];
    const deniedUri = 'myapp://done?error=access_denied&state=stored-state';
    installFetch(async (request) => {
      if (request.method === 'POST') {
        posts.push(new URL(request.url).pathname);
        return jsonResponse({ success: true, data: { redirectUri: deniedUri } });
      }
      return readResponse();
    });
    await renderReady(makeStore());

    const button = screen.getByTestId('native-authorize-deny');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await screen.findByTestId('native-authorize-returning');
    expect(posts).toEqual(['/api/oauth/authorize/deny']);
    expect(assignMock).toHaveBeenCalledWith(deniedUri);
  });

  it('returns to the card when the person retries after a failed approve', async () => {
    let reads = 0;
    installFetch((request) => {
      if (request.method === 'POST') {
        return jsonResponse(
          { success: false, error: { code: 'SOMETHING_NEW', message: 'boom' } },
          500,
        );
      }
      reads += 1;
      return readResponse();
    });
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-approve'));
    await screen.findByTestId('native-authorize-error');

    fireEvent.click(screen.getByTestId('native-authorize-retry'));
    await screen.findByTestId('native-authorize-ready');
    expect(reads).toBe(1);
  });

  it('shows the expired state when an approve call reports an ended transaction', async () => {
    installFetch((request) => {
      if (request.method === 'POST') {
        return jsonResponse(
          {
            success: false,
            error: { code: ErrorCode.NATIVE_TRANSACTION_EXPIRED, message: 'gone' },
          },
          404,
        );
      }
      return readResponse();
    });
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await screen.findByTestId('native-authorize-expired');
    expect(screen.queryByTestId('native-authorize-approve')).toBeNull();
  });

  it('shows the error state and does not navigate when the reply address is not safe', async () => {
    installFetch(async (request) => {
      if (request.method === 'POST') {
        return jsonResponse({
          success: true,
          data: { redirectUri: 'javascript:alert(document.domain)' },
        });
      }
      return readResponse();
    });
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await screen.findByTestId('native-authorize-error');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('shows the error state and does not navigate when the reply has no address', async () => {
    installFetch(async (request) => {
      if (request.method === 'POST') {
        return jsonResponse({ success: true, data: {} });
      }
      return readResponse();
    });
    await renderReady(makeStore());

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await screen.findByTestId('native-authorize-error');
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('native-authorize-returning')).toBeNull();
  });

  it('offers a reopen control two seconds after returning to the app', async () => {
    vi.useFakeTimers();
    installFetch(async (request) => {
      if (request.method === 'POST') {
        return jsonResponse({ success: true, data: { redirectUri: 'myapp://callback' } });
      }
      return readResponse();
    });
    await renderReady(makeStore());

    await act(async () => {
      fireEvent.click(screen.getByTestId('native-authorize-approve'));
    });

    expect(assignMock).toHaveBeenCalledWith('myapp://callback');
    const returning = screen.getByTestId('native-authorize-returning');
    expect(document.activeElement).toBe(within(returning).getByRole('heading', { level: 1 }));
    expect(screen.queryByTestId('native-authorize-reopen')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.queryByTestId('native-authorize-reopen')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('native-authorize-reopen')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('native-authorize-reopen'));
    });
    expect(assignMock).toHaveBeenCalledTimes(2);
  });

  it('clears the reopen timer when the panel unmounts', async () => {
    vi.useFakeTimers();
    installFetch(async (request) => {
      if (request.method === 'POST') {
        return jsonResponse({ success: true, data: { redirectUri: 'myapp://callback' } });
      }
      return readResponse();
    });
    const { unmount } = await renderReady(makeStore());

    await act(async () => {
      fireEvent.click(screen.getByTestId('native-authorize-approve'));
    });
    expect(screen.getByTestId('native-authorize-returning')).toBeTruthy();

    const timersBeforeUnmount = vi.getTimerCount();
    unmount();
    expect(vi.getTimerCount()).toBe(timersBeforeUnmount - 1);
  });
});
