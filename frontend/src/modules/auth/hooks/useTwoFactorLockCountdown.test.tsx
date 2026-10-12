// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTwoFactorLockCountdown } from './useTwoFactorLockCountdown';

const LOCK_ERROR = {
  status: 429,
  data: {
    success: false,
    error: {
      code: ErrorCode.TWO_FACTOR_LOCKED,
      message: 'locked',
      details: { retryAfter: 30 },
    },
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('two-factor lock countdown', () => {
  it('resynchronizes against the retry deadline after a background pause', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T08:00:00.000Z'));
    const { result } = renderHook(() => useTwoFactorLockCountdown());

    act(() => {
      expect(result.current.startForError(LOCK_ERROR)).toBe(true);
    });
    expect(result.current.secondsLeft).toBe(30);
    expect(result.current.isCooling).toBe(true);

    vi.setSystemTime(new Date('2026-10-12T08:00:29.999Z'));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.secondsLeft).toBe(1);

    vi.setSystemTime(new Date('2026-10-12T08:00:30.000Z'));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.isCooling).toBe(false);
  });
});
