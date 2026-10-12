import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAGIC_LINK_MAX_TOKEN_LENGTH } from '../constants/magic-link.constants';

/**
 * Validation stays loose on purpose: a token that is the wrong shape should
 * come back as MAGIC_LINK_INVALID like any other token that does not resolve,
 * so the client has one error code to handle.
 */
export class VerifyMagicLinkDto {
  @ApiProperty({
    description: 'Token from the query string of the mailed link',
    example: 'K3m1s0Xh2Wc9pQ8v7RtY6uI5oP4aS3dF2gH1jK0lZxC',
    maxLength: MAGIC_LINK_MAX_TOKEN_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'Token is required' })
  @MaxLength(MAGIC_LINK_MAX_TOKEN_LENGTH)
  token!: string;

  @ApiPropertyOptional({
    description:
      'Sent as true only after the person confirmed the sign-in on screen. ' +
      'Without it a link opened in another browser, or over another ' +
      "account's session, answers requiresConfirmation and is not spent.",
  })
  // The value as it was sent: text is refused, never read as a yes.
  @Transform(({ obj }: { obj: { confirm?: unknown } }) => obj.confirm)
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
