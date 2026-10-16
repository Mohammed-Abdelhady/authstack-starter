import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/** The largest version a column can hold: a signed 32-bit integer. */
const MAX_VERSION = 2_147_483_647;

/**
 * The version of the account or role this edit was prepared from. A stale
 * one is refused with a conflict. Required only with ADMIN_STRICT_MUTATIONS.
 */
export function StaffVersion(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      description:
        'Version read before this edit. A stale version is refused with CONFLICT. Required when strict staff mutations are on',
      example: 3,
      minimum: 0,
    }),
    ValidateIf((_, value: unknown) => value !== undefined),
    IsInt(),
    Min(0),
    Max(MAX_VERSION),
  );
}

/** `?version=` for a staff DELETE, which carries no body. */
export class StaffVersionQueryDto {
  @StaffVersion()
  version?: number;
}
