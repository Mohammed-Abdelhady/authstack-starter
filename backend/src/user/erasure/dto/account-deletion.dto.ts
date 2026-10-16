import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  DELETION_RECEIPT_STATE,
  type DeletionReceiptState,
} from '../constants/deletion-receipt.constants';

/** The longest key the pattern allows (`r1.`, 15 digits, `.`, 64 hex), so a long body is refused early. */
const RECEIPT_KEY_MAX_LENGTH = 83;

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'A key the client made and stored before sending, `r1.<epoch ms>.<64 hex>`. ' +
      'Its hash is stored with the deletion for 90 days, and ' +
      'GET /api/auth/account-deletion/{key} answers whether it was recorded.',
    example: `r1.1760000000000.${'0f'.repeat(32)}`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(RECEIPT_KEY_MAX_LENGTH)
  receiptKey?: string;
}

export class AccountDeletionResultDto {
  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({
    description:
      'Present while erasure is on: when the account will be erased, ISO 8601',
  })
  eraseAfter?: string;
}

export class DeletionReceiptDto {
  @ApiProperty({
    enum: Object.values(DELETION_RECEIPT_STATE),
    description:
      '`recorded`: a deletion with this key committed. `not_recorded`: none ' +
      'did as far as the server knows now; a request on its way may still ' +
      'land, so ask again after a wait. `unknown`: the key or its receipt is ' +
      'older than 90 days.',
  })
  state!: DeletionReceiptState;
}
