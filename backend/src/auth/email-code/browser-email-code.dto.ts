import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { LanguagePreference } from '../../common/decorators/language-preference.decorator';

export class RequestBrowserEmailCodeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  readonly email: string = '';

  @LanguagePreference()
  locale?: string;
}

export class VerifyBrowserEmailCodeDto {
  @IsString()
  @Matches(/^\d{6}$/u)
  readonly code: string = '';
}
