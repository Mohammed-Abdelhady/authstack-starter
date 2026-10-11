import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TwoFactorCodeDto } from './two-factor-code.dto';

/**
 * Replacing the recovery codes needs a code, plus the password when the
 * account has one. The new codes are a way past the second factor, so a code
 * read off a screen must not be enough to get them.
 */
export class RegenerateRecoveryCodesDto extends TwoFactorCodeDto {
  @ApiProperty({
    description: 'Current password, required for accounts that have one',
    example: 'Password123!',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}
