import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { LanguagePreference } from '../../common/decorators/language-preference.decorator';

/**
 * Registration takes the address only. `password` and `name` stay declared so
 * an old client's body can be recognised and refused with a stable contract
 * error instead of a generic unknown-property failure.
 */
export class RegisterDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
    maxLength: 255,
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase()?.trim())
  email!: string;

  @ApiProperty({
    description: 'Removed from registration; belongs on activation now',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsString({ message: 'Password must be a string' })
  password?: string;

  @ApiProperty({
    description: 'Removed from registration; belongs on activation now',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @LanguagePreference()
  locale?: string;
}
