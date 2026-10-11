import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { IdFormat } from '../../common/persistence/id-format';

/**
 * Reject an identifier this installation's database could not have issued.
 *
 * @param ids - What the database takes as an id
 * @param id - Value taken from the request
 * @param message - Message returned to the caller
 * @throws AppException INVALID_INPUT
 */
export function assertValidId(
  ids: IdFormat,
  id: string,
  message: string,
): void {
  if (!ids.isId(id)) {
    throw new AppException(
      ErrorCode.INVALID_INPUT,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Whether two ids name the same record. Both databases read an id whatever
 * the case of its letters, so the comparison does too.
 */
export function isSameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export { assertActiveUser } from './account-lookup.util';
