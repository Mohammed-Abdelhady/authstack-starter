import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { LANGUAGE_TAG_MAX_LENGTH } from '../constants/locales';

const REQUEST_LANGUAGE =
  'Language for the mail and for an account this request creates. ' +
  'Falls back to Accept-Language, then to English.';

/**
 * The optional `locale` a request that may create an account or mail an
 * address carries. Any language tag is accepted: one this build does not
 * support falls back as the description says.
 */
export function LanguagePreference(
  description = REQUEST_LANGUAGE,
): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      description,
      example: 'en',
      maxLength: LANGUAGE_TAG_MAX_LENGTH,
    }),
    IsOptional(),
    IsString({ message: 'Locale must be a string' }),
    MaxLength(LANGUAGE_TAG_MAX_LENGTH, {
      message: `Locale must not exceed ${LANGUAGE_TAG_MAX_LENGTH} characters`,
    }),
  );
}
