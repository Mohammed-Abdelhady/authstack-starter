import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '../enums/error-code.enum';
import { AppException } from '../exceptions/app.exception';
import { IdFormat } from '../persistence/id-format';

const ROUTE_ID_MAX_LENGTH = 128;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** True for text any database could use as an id in a path. */
export function couldBeRouteId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= ROUTE_ID_MAX_LENGTH &&
    ROUTE_ID_PATTERN.test(value)
  );
}

/**
 * Takes an id from the path as an opaque string. It refuses what no database
 * could use, then asks the adapter whether this one could have issued it, so
 * the refusal comes before the body is validated and before any read.
 *
 * The answer is the one these routes have always given, which is not the one
 * the global filter gives a `MalformedIdError` a store raises.
 */
@Injectable()
export class RouteIdPipe implements PipeTransform<unknown, string> {
  constructor(private readonly ids: IdFormat) {}

  transform(value: unknown): string {
    if (!couldBeRouteId(value) || !this.ids.isId(value)) {
      throw new AppException(
        ErrorCode.INVALID_INPUT,
        'Invalid identifier format',
        HttpStatus.BAD_REQUEST,
      );
    }
    return value;
  }
}
