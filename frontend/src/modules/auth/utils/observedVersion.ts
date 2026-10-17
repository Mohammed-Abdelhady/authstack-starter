import { ErrorCode } from '@app/core';
import { HTTP_STATUS } from '@/constants/httpStatus';

export function requireObservedVersion(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw {
    status: HTTP_STATUS.BAD_REQUEST,
    data: {
      success: false,
      error: { code: ErrorCode.VALIDATION_ERROR, details: { fields: { version: [] } } },
    },
  };
}
