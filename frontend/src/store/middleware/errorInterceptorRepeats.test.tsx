// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { Toaster, toast } from 'sonner';
import { loadMessages } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { errorInterceptor } from './errorInterceptor';

const NETWORK_FAILURE = { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' };
const SERVER_FAILURE = {
  status: 500,
  data: { success: false, error: { code: 'INTERNAL_ERROR', message: 'English server text' } },
};

/** Sends one rejected request through the interceptor, as the query layer does. */
function reject(
  endpointName: string,
  payload: Record<string, unknown>,
  queryCacheKey = endpointName,
  type: 'query' | 'mutation' = 'query',
) {
  errorInterceptor({ dispatch: vi.fn(), getState: () => ({ auth: { isAuthenticated: false } }) })(
    vi.fn(),
  )({
    type: `api/execute${type === 'query' ? 'Query' : 'Mutation'}/rejected`,
    payload,
    error: { name: 'Error', message: 'Rejected' },
    meta: {
      requestId: endpointName,
      requestStatus: 'rejected',
      rejectedWithValue: true,
      aborted: false,
      condition: false,
      arg: { endpointName, type, queryCacheKey },
    },
  });
}

function fulfill(endpointName: string, queryCacheKey = endpointName) {
  errorInterceptor({
    dispatch: vi.fn(),
    getState: () => ({
      auth: { isAuthenticated: false },
      api: { queries: { [queryCacheKey]: { status: 'pending', error: SERVER_FAILURE } } },
    }),
  })(vi.fn())({
    type: 'api/executeQuery/fulfilled',
    payload: {},
    meta: {
      requestId: endpointName,
      requestStatus: 'fulfilled',
      arg: { endpointName, type: 'query', queryCacheKey },
    },
  });
}

/** The real toast region, so what is counted is what a person would see. */
async function renderToasts() {
  const messages = await loadMessages('en');
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <Toaster />
    </NextIntlClientProvider>,
  );
  return (key: string) => lookupMessage(messages, key);
}

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
});

describe('how many toasts a failure raises', () => {
  it('shows one toast when two requests fail because the server cannot be reached', async () => {
    const message = await renderToasts();

    act(() => {
      reject('getAuthMethods', NETWORK_FAILURE);
      reject('getCurrentUser', NETWORK_FAILURE);
      // Raised last, so once it is on screen the two before it have been drawn.
      reject('createRole', SERVER_FAILURE);
    });

    await screen.findByText(message('errors.codes.INTERNAL_ERROR'));
    expect(screen.getAllByText(message('toast.error.networkError'))).toHaveLength(1);
  });

  it('shows a toast for each request the server refused', async () => {
    const message = await renderToasts();

    act(() => {
      reject('createRole', SERVER_FAILURE);
      reject('updateRole', SERVER_FAILURE);
    });

    await waitFor(() =>
      expect(screen.getAllByText(message('errors.codes.INTERNAL_ERROR'))).toHaveLength(2),
    );
  });

  it('shows separate notices when the same mutation is refused twice', async () => {
    const message = await renderToasts();

    act(() => {
      reject('createRole', SERVER_FAILURE, 'createRole', 'mutation');
      reject('createRole', SERVER_FAILURE, 'createRole', 'mutation');
    });

    await waitFor(() =>
      expect(screen.getAllByText(message('errors.codes.INTERNAL_ERROR'))).toHaveLength(2),
    );
  });

  it('keeps one visible toast when the same polling read fails with 503 twice', async () => {
    const message = await renderToasts();
    const unavailable = {
      status: 503,
      data: {
        success: false,
        error: { code: 'AUTHORITY_UNAVAILABLE', message: 'English server text' },
      },
    };

    act(() => {
      reject('getSessions', unavailable);
      reject('getSessions', unavailable);
    });

    await screen.findByText(message('errors.codes.AUTHORITY_UNAVAILABLE'));
    expect(screen.getAllByText(message('errors.codes.AUTHORITY_UNAVAILABLE'))).toHaveLength(1);
  });

  it('keeps separate toasts for different query arguments and dismisses only a recovered read', async () => {
    const message = await renderToasts();
    const unavailable = {
      status: 503,
      data: {
        success: false,
        error: { code: 'AUTHORITY_UNAVAILABLE', message: 'English server text' },
      },
    };

    act(() => {
      reject('getUserById', unavailable, 'getUserById("user-1")');
      reject('getUserById', unavailable, 'getUserById("user-2")');
    });
    await waitFor(() =>
      expect(screen.getAllByText(message('errors.codes.AUTHORITY_UNAVAILABLE'))).toHaveLength(2),
    );

    act(() => fulfill('getUserById', 'getUserById("user-1")'));
    await waitFor(() =>
      expect(screen.getAllByText(message('errors.codes.AUTHORITY_UNAVAILABLE'))).toHaveLength(1),
    );

    act(() => reject('getUserById', unavailable, 'getUserById("user-1")'));
    await waitFor(() =>
      expect(screen.getAllByText(message('errors.codes.AUTHORITY_UNAVAILABLE'))).toHaveLength(2),
    );
  });
});
