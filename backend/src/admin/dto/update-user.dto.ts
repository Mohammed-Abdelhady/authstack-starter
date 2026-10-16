import { IsEmail, IsOptional, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from '../../common/constants/name';
import {
  NamePolicy,
  transformTrimmedName,
} from '../../common/decorators/name-policy.decorator';
import { StaffVersion } from './staff-version.decorator';

/**
 * DTO for updating user basic information.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'User full name',
    example: 'John Doe',
    minLength: NAME_MIN_LENGTH,
    maxLength: NAME_MAX_LENGTH,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(transformTrimmedName)
  @NamePolicy()
  name?: string;

  @ApiPropertyOptional({
    description: 'User email address',
    example: 'john.doe@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;

  @StaffVersion()
  version?: number;
}
