import type { LoggerService } from '@nestjs/common';
import { describeDriverError } from '../../common/utils/describe-error.util';

export function logUnknownCommit(
  logger: LoggerService,
  operation: string,
  error: unknown,
): void {
  logger.error(
    `${operation} commit result unknown: ${describeDriverError(error)}`,
  );
}
