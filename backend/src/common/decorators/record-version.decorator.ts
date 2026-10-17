import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/** The largest version a column can hold: a signed 32-bit integer. */
const MAX_VERSION = 2_147_483_647;

/** Validates a supplied observed record version; the caller decides whether it is required. */
export function RecordVersion(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      description: 'Record version observed before this write.',
      example: 3,
      minimum: 0,
    }),
    ValidateIf((_, value: unknown) => value !== undefined),
    IsInt(),
    Min(0),
    Max(MAX_VERSION),
  );
}
