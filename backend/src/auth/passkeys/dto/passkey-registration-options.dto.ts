import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches, // feature:totp
  MaxLength,
} from 'class-validator';

/**
 * Body of POST /auth/passkeys/register/options. A passkey signs in on its
 * own, so adding one re-checks who is at the keyboard first: the password for
 * an account that has one, a sign-in younger than five minutes otherwise, and
 * a current code as well when the account has two-factor on.
 */
export class PasskeyRegistrationOptionsDto {
  @ApiProperty({
    description: 'Current password, required for accounts that have one',
    example: 'Password123!',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  // feature:totp:start
  @ApiProperty({
    description:
      'Six digit code from the authenticator app, required when the account ' +
      'has two-factor on and no recovery code is sent',
    example: '123456',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code?: string;

  @ApiProperty({
    description: 'One of the recovery codes, in place of a code',
    example: 'K3M7QRTVWX',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z2-7\s-]{10,24}$/, {
    message: 'recoveryCode must be ten base32 characters',
  })
  recoveryCode?: string;
  // feature:totp:end
}
