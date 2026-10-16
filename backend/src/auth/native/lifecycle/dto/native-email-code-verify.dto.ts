import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { LanguagePreference } from '../../../../common/decorators/language-preference.decorator';

/** Six Western digits, as mailed. Other digits fail here and never count as a guess. */
export class NativeEmailCodeVerifyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{6}$/u)
  code = '';

  @LanguagePreference()
  locale?: string;
}
