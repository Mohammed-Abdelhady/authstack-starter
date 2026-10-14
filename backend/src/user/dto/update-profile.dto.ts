import { Transform } from 'class-transformer';
import { IsIn, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from '../../common/constants/name';
import {
  SUPPORTED_LOCALES,
  SupportedLocale,
} from '../../common/constants/locales';
import {
  NamePolicy,
  transformTrimmedName,
} from '../../common/decorators/name-policy.decorator';

/**
 * DTO for updating user profile.
 * All fields are optional - only provided fields are updated.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'User full name',
    example: 'John Doe',
    minLength: NAME_MIN_LENGTH,
    maxLength: NAME_MAX_LENGTH,
  })
  @ValidateIf(
    (_, value) =>
      // Undefined means absent; null is invalid.
      value !== undefined,
  )
  @Transform(transformTrimmedName)
  @NamePolicy()
  name?: string;

  @ApiPropertyOptional({
    description: 'Language the account is mailed in',
    enum: [...SUPPORTED_LOCALES],
    example: 'en',
  })
  // Undefined means absent; null is refused like any other unsupported value.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(SUPPORTED_LOCALES, {
    message: `Locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: SupportedLocale;
}
