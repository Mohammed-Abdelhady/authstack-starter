import { expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import { ErrorCode } from '@app/core';
import { refusalWith, stubNetwork, success } from './serverRejectionHarness';

type ToastCall = 'error' | 'dismiss' | 'success';

/**
 * Every toast raised or taken down so far, in the order it happened. The test
 * file mocks `sonner` with `error`, `success`, `info` and `dismiss`.
 */
export function toastOrder(): ToastCall[] {
  const calls = (['error', 'dismiss', 'success'] as const).flatMap((what) =>
    vi.mocked(sonnerToast[what]).mock.invocationCallOrder.map((at) => ({ at, what })),
  );
  return calls.sort((a, b) => a.at - b.at).map(({ what }) => what);
}

/**
 * Refuses the first write with a 400 the store raises a toast for, and accepts
 * every later one with `accepted`. A read is answered with `read(path)`.
 */
export function refuseFirstWrite(accepted: unknown, read: (path: string) => unknown = () => ({})) {
  let writes = 0;
  return stubNetwork((request, path) => {
    if (request.method === 'GET') return success(read(path));
    writes += 1;
    return writes === 1 ? refusalWith(400, ErrorCode.VALIDATION_ERROR) : success(accepted);
  });
}

/**
 * Sends a form, waits for the toast of its refusal and for the form to accept
 * input again, then sends it a second time.
 */
export async function sendRefusedThenAgain(send: () => void, isIdle: () => boolean) {
  send();
  await waitFor(() => {
    expect(toastOrder()).toEqual(['error']);
  });
  await waitFor(() => {
    expect(isIdle()).toBe(true);
  });
  send();
}

/**
 * For a form that shows a refusal itself. Sends it, waits until the refusal
 * is on the page and the form takes input again, checks no toast was raised
 * for it, then sends the form a second time.
 */
export async function sendRefusedInPlaceThenAgain(
  send: () => void,
  refusalShown: () => boolean,
  isIdle: () => boolean,
) {
  send();
  await waitFor(() => {
    expect(refusalShown()).toBe(true);
  });
  await waitFor(() => {
    expect(isIdle()).toBe(true);
  });
  expect(toastOrder()).toEqual([]);
  send();
}
