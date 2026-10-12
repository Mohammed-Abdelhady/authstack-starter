import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';

/**
 * Reject an identifier the database could not have issued.
 *
 * @param wellFormed - What the store said about the id
 * @param message - Message returned to the caller
 * @throws AppException INVALID_INPUT
 */
export function assertAccountId(wellFormed: boolean, message: string): void {
  if (!wellFormed) {
    throw new AppException(
      ErrorCode.INVALID_INPUT,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Reject an account that is missing or soft deleted.
 *
 * @param user - Result of an account lookup
 * @throws AppException USER_NOT_FOUND
 */
export function assertActiveUser<T extends { isDeleted: boolean }>(
  user: T | null,
): asserts user is T {
  if (!user || user.isDeleted) {
    throw new AppException(
      ErrorCode.USER_NOT_FOUND,
      'User not found',
      HttpStatus.NOT_FOUND,
    );
  }
}
