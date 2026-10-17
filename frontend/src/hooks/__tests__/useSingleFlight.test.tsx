// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useSharedSingleFlight, useSingleFlight } from '../useSingleFlight';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** An action whose every call stays pending until the test settles it. */
function heldAction() {
  const settle: Array<{ resolve: (value: string) => void; reject: (reason: Error) => void }> = [];
  const action = vi.fn(
    (label: string) =>
      new Promise<string>((resolve, reject) => {
        settle.push({ resolve: (value) => resolve(`${label}:${value}`), reject });
      }),
  );
  return { action, settle };
}

describe('useSingleFlight', () => {
  it('ignores a second call while the first is pending', async () => {
    const { action, settle } = heldAction();
    const { result } = renderHook(() => useSingleFlight(action));

    const first = result.current('a');
    const second = result.current('b');
    settle[0]?.resolve('done');

    expect(await second).toBeUndefined();
    expect(await first).toBe('a:done');
    expect(action.mock.calls).toEqual([['a']]);
  });

  it('runs a new call after the first one resolved', async () => {
    const { action, settle } = heldAction();
    const { result } = renderHook(() => useSingleFlight(action));

    const first = result.current('a');
    settle[0]?.resolve('done');
    await first;
    const next = result.current('b');
    settle[1]?.resolve('again');

    expect(await next).toBe('b:again');
    expect(action.mock.calls).toEqual([['a'], ['b']]);
  });

  it('hands the rejection to the caller and runs a new call after it', async () => {
    const { action, settle } = heldAction();
    const { result } = renderHook(() => useSingleFlight(action));

    const first = result.current('a');
    settle[0]?.reject(new Error('refused'));
    await expect(first).rejects.toThrow('refused');
    const next = result.current('b');
    settle[1]?.resolve('again');

    expect(await next).toBe('b:again');
  });

  it('lets go after an action that throws before it returns a promise', async () => {
    const action = vi.fn((label: string): string => {
      if (label === 'a') throw new Error('threw');
      return label;
    });
    const { result } = renderHook(() => useSingleFlight(action));

    await expect(result.current('a')).rejects.toThrow('threw');

    expect(await result.current('b')).toBe('b');
  });

  it('keeps the first call pending across a render that changes the action', async () => {
    const first = heldAction();
    const second = heldAction();
    const { result, rerender } = renderHook(({ action }) => useSingleFlight(action), {
      initialProps: { action: first.action },
    });

    const pending = result.current('a');
    rerender({ action: second.action });
    const ignored = result.current('b');
    first.settle[0]?.resolve('done');

    expect(await ignored).toBeUndefined();
    expect(await pending).toBe('a:done');
    expect(second.action).not.toHaveBeenCalled();
  });
});

describe('useSharedSingleFlight', () => {
  it('drops a different task while one is pending and runs it afterwards', async () => {
    let release: () => void = () => undefined;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const resend = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSharedSingleFlight());

    const submitting = result.current(submit);
    await result.current(resend);
    expect(resend).not.toHaveBeenCalled();

    release();
    await submitting;
    await result.current(resend);
    expect(resend).toHaveBeenCalledTimes(1);
  });
});
