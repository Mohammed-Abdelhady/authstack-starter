import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@app/core';
import { translatableErrorCode } from '../errorCodeMessage';

function apiError(code: string): unknown {
  return { status: 400, data: { success: false, error: { code, message: code } } };
}

describe('translatableErrorCode', () => {
  it('returns the code the backend sent when it has a message', () => {
    // feature:magic-link:start
    expect(translatableErrorCode(apiError(ErrorCode.MAGIC_LINK_INVALID))).toBe(
      ErrorCode.MAGIC_LINK_INVALID,
    );
    // feature:magic-link:end
    expect(translatableErrorCode(apiError(ErrorCode.FEATURE_DISABLED))).toBe(
      ErrorCode.FEATURE_DISABLED,
    );
  });

  it.each([
    [409, 'SESSION_LIMIT_REACHED', 'errors.codes.SESSION_LIMIT_REACHED'],
    [503, 'AUTHORITY_UNAVAILABLE', 'errors.codes.AUTHORITY_UNAVAILABLE'],
  ])('selects the catalog key for a %i sign-in failure', (status, code, expectedKey) => {
    expect(
      `errors.codes.${translatableErrorCode({
        status,
        data: { success: false, error: { code, message: 'Backend message' } },
      })}`,
    ).toBe(expectedKey);
  });

  it('allows the caller to preserve its fallback for missing and unknown codes', () => {
    expect(translatableErrorCode({ status: 409, data: {} }, '')).toBe('');
    expect(translatableErrorCode(apiError('SOMETHING_NEW'), '')).toBe('');
  });

  it('falls back for a code this client does not know', () => {
    expect(translatableErrorCode(apiError('SOMETHING_NEW'))).toBe(ErrorCode.INTERNAL_ERROR);
    // feature:magic-link:start
    expect(translatableErrorCode(apiError('SOMETHING_NEW'), ErrorCode.MAGIC_LINK_INVALID)).toBe(
      ErrorCode.MAGIC_LINK_INVALID,
    );
    // feature:magic-link:end
  });

  // feature:locale-ar:start
  // feature:locale-ar:end
});
