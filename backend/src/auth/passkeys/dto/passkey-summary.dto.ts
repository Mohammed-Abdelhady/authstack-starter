import { ApiProperty } from '@nestjs/swagger';

/** One passkey as the account settings show it. No key material leaves here. */
export class PasskeySummaryDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id!: string;

  @ApiProperty({ example: 'MacBook Touch ID' })
  name!: string;

  @ApiProperty({
    description: 'singleDevice for a key bound to one device, else multiDevice',
    example: 'multiDevice',
    required: false,
  })
  deviceType?: string;

  @ApiProperty({
    description: 'Whether the credential is synced to a provider keychain',
    example: true,
  })
  backedUp!: boolean;

  @ApiProperty({ example: '2026-01-05T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({
    description: 'Null until the passkey has been used to sign in',
    example: '2026-02-01T09:12:00.000Z',
    required: false,
    nullable: true,
  })
  lastUsedAt!: Date | null;
}

/** Payload of GET /auth/passkeys. */
export class PasskeyListResponseDto {
  @ApiProperty({ type: [PasskeySummaryDto] })
  passkeys!: PasskeySummaryDto[];

  @ApiProperty({
    description:
      'Whether removing one of the listed passkeys would be accepted now. ' +
      'False when it would be refused with PASSKEY_LAST_SIGN_IN_METHOD. ' +
      'Advice for a page: the removal itself still decides.',
    example: true,
    required: false,
  })
  canRemove?: boolean;
}
