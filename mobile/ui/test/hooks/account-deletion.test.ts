import { AuthSessionError, type AbortSignalPort } from '@app/native-auth';
import type { Transport, TransportRequest, TransportResponse } from '@app/sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../src/context/ui-context';
import { useAccountDeletion } from '../../src/hooks/use-account-deletion';
import type { DeletionReceiptStorage } from '../../src/types/account-deletion';
import { deferred, signedInAs, type Deferred } from '../support/fake-engine';
import { noResponse, ok, refusal, settle } from '../support/fake-server';
import { renderUiHook } from '../support/hook';
import { cleanup, flush } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const KEY = 'r1.1781078520000.0000000000000000000000000000000000000000000000000000000000000000';

async function setup(stored: string | null = null, engineSignedOut = false) {
  const calls: {
    request: TransportRequest<AbortSignalPort>;
    answer: Deferred<TransportResponse>;
  }[] = [];
  const transport: Transport<AbortSignalPort> = {
    request(request) {
      const answer = deferred<TransportResponse>();
      calls.push({ request, answer });
      return answer.promise;
    },
  };
  const receipts = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (_key: string): Promise<void> => undefined),
    clear: vi.fn(async () => undefined),
  } satisfies DeletionReceiptStorage;
  const onDeleted = vi.fn();
  const randomBytes = vi.fn(async () => new Uint8Array(32));
  // The deletion ended the session, so the engine has no tokens to send with.
  const signedOut: Transport<AbortSignalPort>['request'] = () =>
    Promise.reject(new AuthSessionError());
  const subject = await renderUiHook(() => {
    useUi().runtime.engine.transport.request = engineSignedOut ? signedOut : transport.request;
    return useAccountDeletion({ receipts, randomBytes, onDeleted, receiptTransport: transport });
  }, signedInAs('ada'));
  async function answer(index: number, response: TransportResponse) {
    await act(async () => {
      calls[index]?.answer.resolve(response);
      await settle();
    });
  }
  async function start() {
    act(() => subject.current().remove());
    await subject.confirm.answer(true);
  }
  async function lost() {
    await start();
    await act(async () => {
      calls[0]?.answer.reject(noResponse());
    });
    await flush();
  }
  return { subject, calls, receipts, onDeleted, randomBytes, answer, start, lost };
}

describe('safe account deletion', () => {
  it('persists the key before sending deletion', async () => {
    const app = await setup();
    const saved = deferred<void>();
    app.receipts.write.mockImplementation(() => saved.promise);
    await app.start();
    expect(app.receipts.write).toHaveBeenCalledWith(KEY);
    expect(app.calls).toHaveLength(0);
    await act(async () => saved.resolve());
    await flush();
    expect(app.calls.map(({ request }) => request)).toEqual([
      { method: 'DELETE', path: '/api/user/account', body: { receiptKey: KEY } },
    ]);
  });

  it('confirms a lost answer only when the receipt is recorded, once', async () => {
    const app = await setup();
    await app.lost();
    expect(app.onDeleted).toHaveBeenCalledTimes(0);
    expect(app.calls[1]?.request).toEqual({
      method: 'GET',
      path: `/api/auth/account-deletion/${KEY}`,
    });
    await app.answer(1, ok({ state: 'recorded' }));
    act(() => {
      app.subject.current().retry();
      app.subject.current().remove();
    });
    await flush();
    expect(app.subject.current().view).toBe('deleted');
    expect(app.receipts.clear).toHaveBeenCalledTimes(1);
    expect(app.onDeleted).toHaveBeenCalledTimes(1);
    expect(app.calls).toHaveLength(2);
  });

  it('waits ten seconds and confirms a later recorded receipt', async () => {
    vi.useFakeTimers();
    const app = await setup();
    await app.lost();
    await app.answer(1, ok({ state: 'not_recorded' }));
    expect(app.onDeleted).toHaveBeenCalledTimes(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9999);
    });
    expect(app.calls).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(app.calls).toHaveLength(3);
    await app.answer(2, ok({ state: 'recorded' }));
    expect(app.subject.current().view).toBe('deleted');
    expect(app.onDeleted).toHaveBeenCalledTimes(1);
  });

  it('allows a new deletion after two not-recorded receipts without claiming deletion', async () => {
    vi.useFakeTimers();
    const app = await setup();
    await app.lost();
    await app.answer(1, ok({ state: 'not_recorded' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    await app.answer(2, ok({ state: 'not_recorded' }));
    expect(app.subject.current().canDelete).toBe(true);
    expect(app.subject.current().notice).toBe('deletion.notDeleted');
    expect(app.receipts.clear).toHaveBeenCalledTimes(1);
    expect(app.onDeleted).toHaveBeenCalledTimes(0);
  });

  it('clears a definite refusal without claiming deletion', async () => {
    const app = await setup();
    await app.start();
    await app.answer(0, refusal(403, 'ADMIN_CANNOT_DEACTIVATE_SELF'));
    expect(app.subject.current().notice).toBe('deletion.admin');
    expect(app.receipts.clear).toHaveBeenCalledTimes(1);
    expect(app.onDeleted).toHaveBeenCalledTimes(0);
    expect(app.calls).toHaveLength(1);
  });

  it('checks a persisted key before offering deletion after restart', async () => {
    const app = await setup(KEY);
    expect(app.subject.current().canDelete).toBe(false);
    act(() => app.subject.current().remove());
    expect(app.calls.map(({ request }) => request)).toEqual([
      { method: 'GET', path: `/api/auth/account-deletion/${KEY}` },
    ]);
    expect(app.subject.confirm.asked).toHaveLength(0);
    await app.answer(0, ok({ state: 'recorded' }));
    expect(app.subject.current().view).toBe('deleted');
    expect(app.onDeleted).toHaveBeenCalledTimes(1);
  });

  it('confirms a deletion from before a restart once the engine has signed out', async () => {
    const app = await setup(KEY, true);
    expect(app.calls.map(({ request }) => request)).toEqual([
      { method: 'GET', path: `/api/auth/account-deletion/${KEY}` },
    ]);
    await app.answer(0, ok({ state: 'recorded' }));
    expect(app.subject.current().view).toBe('deleted');
    expect(app.onDeleted).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on a second press during deletion', async () => {
    const app = await setup();
    await app.start();
    act(() => {
      app.subject.current().remove();
      app.subject.current().retry();
    });
    await flush();
    expect(app.calls).toHaveLength(1);
    expect(app.subject.confirm.asked).toHaveLength(1);
    expect(app.randomBytes).toHaveBeenCalledTimes(1);
  });
});
