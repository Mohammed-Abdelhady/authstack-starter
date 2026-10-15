import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PickType,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfirmEmailChangeDto } from '../../../auth/dto/confirm-email-change.dto';
import { OWN_EMAIL_PASSWORD_MAX_LENGTH } from '../constants/own-email';

/**
 * The account's password, for when the session alone cannot prove who is
 * asking: a browser sign-in older than five minutes, or any mobile session.
 */
export class OwnEmailProofDto {
  @ApiPropertyOptional({
    description:
      'Current password, for an account that has one, when the session ' +
      'holds no sign-in from the last five minutes',
    example: 'Password123!',
  })
  @IsOptional()
  @IsString()
  @MaxLength(OWN_EMAIL_PASSWORD_MAX_LENGTH)
  password?: string;
}

/** The address to move the account to. Validated like every other address. */
export class RequestOwnEmailChangeDto extends IntersectionType(
  PickType(ConfirmEmailChangeDto, ['email'] as const),
  OwnEmailProofDto,
) {}

/** The six digits mailed to the address the account waits to confirm. */
export class ConfirmOwnEmailChangeDto extends PickType(ConfirmEmailChangeDto, [
  'code',
] as const) {}

/** The account's address, and the one it waits to confirm. */
export class OwnEmailDto {
  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiPropertyOptional({
    description: 'The address asked for, until it is confirmed or cancelled',
    example: 'new@example.com',
  })
  pendingEmail?: string;
}
