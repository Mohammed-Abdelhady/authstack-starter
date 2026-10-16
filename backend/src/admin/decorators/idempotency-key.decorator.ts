import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
} from '../../common/constants/idempotency';
import { ValidationFailedException } from '../../common/exceptions/validation-failed.exception';

const FIELD = 'idempotencyKey';

/** The create's idempotency key, or undefined when none was sent. */
export function idempotencyKeyOf(request: Request): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && IDEMPOTENCY_KEY_PATTERN.test(raw)) return raw;
  throw new ValidationFailedException(
    {
      [FIELD]: [
        'Idempotency-Key must be 8 to 128 letters, digits, hyphens or underscores',
      ],
    },
    { fieldNames: [FIELD], omittedCount: 0 },
  );
}

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    idempotencyKeyOf(context.switchToHttp().getRequest<Request>()),
);
