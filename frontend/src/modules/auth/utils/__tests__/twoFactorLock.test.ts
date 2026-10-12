import { ErrorCode } from '@app/core';
import { describe, expect, it } from 'vitest';
import { twoFactorLockSeconds } from '../twoFactorLock';

describe('two-factor lock retry duration', () => {
  it('uses the server retryAfter while rejecting malformed or unrelated details', () => {
    expect(
      twoFactorLockSeconds({
        status: 429,
        data: {
          success: false,
          error: {
            code: ErrorCode.TWO_FACTOR_LOCKED,
            message: 'locked',
            details: { retryAfter: 60 },
          },
        },
      }),
    ).toBe(60);
    expect(
      twoFactorLockSeconds({
        status: 429,
        data: {
          success: false,
          error: {
            code: ErrorCode.TWO_FACTOR_LOCKED,
            message: 'locked',
            details: { retryAfter: '60' },
          },
        },
      }),
    ).toBeNull();
    expect(
      twoFactorLockSeconds({
        status: 429,
        data: {
          success: false,
          error: {
            code: ErrorCode.TWO_FACTOR_LOCKED,
            message: 'locked',
            details: {},
          },
        },
      }),
    ).toBeNull();
    expect(
      twoFactorLockSeconds({
        status: 429,
        data: {
          success: false,
          error: {
            code: ErrorCode.TWO_FACTOR_LOCKED,
            message: 'locked',
            details: { retryAfter: 3601 },
          },
        },
      }),
    ).toBeNull();
    expect(
      twoFactorLockSeconds({
        status: 429,
        data: {
          success: false,
          error: {
            code: ErrorCode.TWO_FACTOR_CODE_INVALID,
            message: 'wrong code',
            details: { retryAfter: 60 },
          },
        },
      }),
    ).toBeNull();
  });
});
