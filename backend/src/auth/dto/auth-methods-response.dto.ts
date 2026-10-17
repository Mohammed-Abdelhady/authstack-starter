import { ApiProperty } from '@nestjs/swagger';
import { OAuthProviderSummary } from '../oauth/oauth-provider.interface'; // feature:oauth-core

export class AuthMethodsDto {
  @ApiProperty({
    description: 'Email and password sign-in is available',
    example: true,
  })
  password!: boolean;

  // feature:email-code:start
  @ApiProperty({ description: 'Sign-in codes can be requested' })
  emailCode: boolean = false;
  // feature:email-code:end

  // feature:magic-link:start
  @ApiProperty({
    description: 'Sign-in links can be requested',
    example: true,
  })
  magicLink!: boolean;
  // feature:magic-link:end

  // feature:totp:start
  @ApiProperty({
    description: 'Accounts may add a TOTP second factor',
    example: true,
  })
  twoFactor!: boolean;
  // feature:totp:end

  // feature:passkeys:start
  @ApiProperty({
    description: 'Passkeys can be registered and used to sign in',
    example: true,
  })
  passkeys!: boolean;
  // feature:passkeys:end

  // feature:oauth-core:start
  @ApiProperty({
    description: 'OAuth providers with credentials configured',
    example: [{ id: 'google', displayName: 'Google' }],
  })
  oauth!: OAuthProviderSummary[];
  // feature:oauth-core:end
}

/** Payload of GET /auth/methods, read by the client to pick what to render. */
export class AuthMethodsResponseDto {
  @ApiProperty({
    description: 'Whether account audience separation is enforced',
  })
  audiencesEnabled: boolean = false;

  @ApiProperty({ type: AuthMethodsDto })
  methods!: AuthMethodsDto;
}
