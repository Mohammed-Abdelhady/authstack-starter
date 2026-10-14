import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';
import { USER_LEVEL } from '../../common/utils/role-hierarchy';

/**
 * An optional role level: an integer of at least 1, or left out. `null` is
 * refused, unlike with `@IsOptional`, so a role cannot be stored without one.
 */
export function RoleLevelProperty(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      description:
        'Hierarchy level, below the level of the caller. 1 when left out on create, unchanged when left out on update',
      example: 2,
      minimum: USER_LEVEL,
    }),
    ValidateIf((_, value: unknown) => value !== undefined),
    IsInt(),
    Min(USER_LEVEL),
  );
}
