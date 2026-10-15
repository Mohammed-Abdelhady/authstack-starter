import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { ConfirmEmailChangeDto } from '../../../auth/dto/confirm-email-change.dto';

/** The address to move the account to. Validated like every other address. */
export class RequestOwnEmailChangeDto extends PickType(ConfirmEmailChangeDto, [
  'email',
] as const) {}

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
