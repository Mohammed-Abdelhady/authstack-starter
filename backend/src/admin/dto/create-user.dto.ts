import { IsEmail, IsString, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ROLE_SLUG_MAX_LENGTH,
  ROLE_SLUG_MESSAGE,
  ROLE_SLUG_REGEX,
} from '../../common/constants/roles';
import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from '../../common/constants/name';
import {
  NamePolicy,
  transformTrimmedName,
} from '../../common/decorators/name-policy.decorator';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_DESCRIPTION,
} from '../../common/constants/password';
import { PasswordPolicy } from '../../common/decorators/password-policy.decorator';
import { LanguagePreference } from '../../common/decorators/language-preference.decorator';

/**
 * DTO for creating a new user via admin panel.
 * Any existing role slug is accepted, including custom ones. The service
 * checks that the role exists and that the actor outranks it.
 */
export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'john.doe@example.com',
  })
  @IsEmail({}, { message: 'Invalid email address' })
  email!: string;

  @ApiProperty({
    description: 'User full name',
    example: 'John Doe',
    minLength: NAME_MIN_LENGTH,
    maxLength: NAME_MAX_LENGTH,
  })
  @Transform(transformTrimmedName)
  @NamePolicy()
  name!: string;

  @ApiProperty({
    description: PASSWORD_POLICY_DESCRIPTION,
    example: 'SecureP@ssw0rd',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_BYTES,
  })
  @IsString()
  @PasswordPolicy()
  password!: string;

  @ApiProperty({
    description:
      'Role slug to assign. Must exist and sit below the actor role level. ' +
      'ADMIN cannot be assigned through the API.',
    example: 'user',
  })
  @IsString()
  @MaxLength(ROLE_SLUG_MAX_LENGTH)
  @Matches(ROLE_SLUG_REGEX, { message: ROLE_SLUG_MESSAGE })
  role!: string;

  @LanguagePreference(
    "Language of the new account's mail. Unsupported or absent means " +
      "English; the administrator's own Accept-Language is not used.",
  )
  locale?: string;
}
