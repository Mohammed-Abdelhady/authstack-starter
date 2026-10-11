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
function reject(endpointName: string, payload: Record<string, unknown>) {
  errorInterceptor({ dispatch: vi.fn(), getState: () => ({ auth: { isAuthenticated: false } }) })(
    vi.fn(),
  )({
    type: 'api/executeQuery/rejected',
    payload,
    error: { name: 'Error', message: 'Rejected' },
    meta: {
      requestId: endpointName,
      requestStatus: 'rejected',
      rejectedWithValue: true,
      aborted: false,
      condition: false,
      arg: { endpointName },
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
});
