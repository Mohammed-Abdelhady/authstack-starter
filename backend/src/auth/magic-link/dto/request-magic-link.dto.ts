import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LanguagePreference } from '../../../common/decorators/language-preference.decorator';

export class RequestMagicLinkDto {
  @ApiProperty({
    description: 'Address the sign-in link is mailed to',
    example: 'user@example.com',
    maxLength: 255,
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase()?.trim())
  email!: string;

  @ApiPropertyOptional({
    description:
      'Allowed relative native authorization route to resume after sign-in',
    example: '/en/auth/native/authorize?transaction=abc-123',
  })
  @IsOptional()
  @IsString()
  redirect?: string;

  @LanguagePreference()
  locale?: string;
}
