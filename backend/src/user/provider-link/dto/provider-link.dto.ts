import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, Matches } from 'class-validator';
import { IsRegisteredProvider } from '../../../auth/oauth/validators/is-registered-provider.validator';
import { PROVIDER_LINK_ID_PATTERN } from '../constants/provider-link.constants';

export class StartProviderLinkDto {
  @ApiProperty({
    description: 'Registered OAuth provider id to link from this app',
    example: 'google',
  })
  @IsRegisteredProvider()
  @IsNotEmpty()
  provider!: string;
}

export class FinishProviderLinkDto {
  @ApiProperty({ description: 'The `linkId` the start answered' })
  @Matches(PROVIDER_LINK_ID_PATTERN)
  linkId!: string;

  @ApiProperty({
    description:
      "The provider's proof as native sign-in takes it, made with the start's `nonceDigest`",
    type: Object,
  })
  @IsObject()
  credential!: Record<string, unknown>;
}

export class ProviderLinkStartDto {
  @ApiProperty({ description: 'Sent back with the proof to finish the link' })
  linkId!: string;

  @ApiProperty({
    description: "The nonce digest to pass to the provider's prompt",
  })
  nonceDigest!: string;

  @ApiProperty({ description: "The state to pass to the provider's prompt" })
  state!: string;

  @ApiProperty({ description: 'When the link lapses, ISO 8601' })
  expiresAt!: string;
}
