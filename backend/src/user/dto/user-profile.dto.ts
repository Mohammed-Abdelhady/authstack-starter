import { DEVICE_KIND } from '../../common/constants/session';
import type { DeviceParts } from '@app/sdk';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for user profile response.
 */
export class UserProfileDto {
  @ApiProperty({
    description: 'User ID',
    example: '507f1f77bcf86cd799439011',
  })
  id!: string;

  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'User full name',
    example: 'John Doe',
  })
  name!: string;

  @ApiProperty({
    description:
      'User role slug (user, support, manager, admin, or custom roles)',
    example: 'user',
  })
  role!: string;

  @ApiProperty({
    description: 'User permissions array',
    example: ['profile:read:own', 'profile:update:own'],
    type: [String],
  })
  permissions!: string[];

  @ApiProperty({
    description:
      "Provider the account was created with: 'email' or an OAuth provider id",
    example: 'email',
  })
  authProvider!: string;

  @ApiProperty({
    description: 'Whether the user email is verified',
    example: true,
  })
  isVerified!: boolean;

  // feature:totp:start
  @ApiProperty({
    description: 'Whether sign-in on this account asks for a TOTP code',
    example: false,
  })
  twoFactorEnabled!: boolean;
  // feature:totp:end

  // feature:passkeys:start
  @ApiProperty({
    description: 'How many passkeys are registered on the account',
    example: 2,
  })
  passkeyCount!: number;
  // feature:passkeys:end

  @ApiProperty({
    description: 'Avatar URL synced from the primary provider',
    example: null,
    required: false,
  })
  avatarUrl?: string;

  @ApiProperty({
    description:
      "Sign-in methods on the account: 'email' plus linked provider ids",
    example: ['email', 'google'],
    type: [String],
  })
  linkedProviders!: string[];

  @ApiProperty({
    description: 'Provider id used as the source for profile synchronization',
    example: 'google',
    required: false,
  })
  primaryProvider?: string;

  @ApiProperty({
    description: 'Timestamp of last profile synchronization',
    example: '2024-01-15T09:00:00.000Z',
    required: false,
  })
  profileSyncedAt?: Date;

  @ApiProperty({
    description: 'Account creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt?: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt?: Date;
}

export class DevicePartsDto implements DeviceParts {
  @ApiProperty({
    enum: Object.values(DEVICE_KIND),
    example: DEVICE_KIND.BROWSER,
  })
  kind!: DeviceParts['kind'];

  @ApiProperty({ required: false, example: 'Chrome' })
  browserName?: string;

  @ApiProperty({ required: false, example: '140' })
  browserMajorVersion?: string;

  @ApiProperty({ required: false, example: 'macOS' })
  platformName?: string;

  @ApiProperty({ required: false, example: '10.15' })
  platformVersion?: string;
}

/**
 * DTO for session information.
 */
export class SessionDto {
  @ApiProperty({
    description: 'Session ID',
    example: '507f1f77bcf86cd799439011',
  })
  id!: string;

  @ApiProperty({
    description: 'User agent string from the HTTP client',
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  })
  userAgent!: string;

  @ApiProperty({
    description: 'IP address of session',
    example: '192.168.1.1',
  })
  ip!: string;

  @ApiProperty({
    description: 'Detected device name',
    example: 'Chrome on Windows',
    required: false,
  })
  deviceName?: string;

  @ApiProperty({
    description:
      'Language-neutral device parts derived from the stored user agent. Library and kernel versions are not platform versions.',
    required: false,
    type: () => DevicePartsDto,
  })
  deviceParts?: DeviceParts;

  @ApiProperty({
    description: 'Session creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Last activity timestamp',
    example: '2024-01-15T11:30:00.000Z',
    required: false,
  })
  lastUsedAt?: Date;

  @ApiProperty({
    description: 'Whether this is the current session',
    example: true,
  })
  isCurrent!: boolean;

  @ApiProperty({
    description:
      'Credential kind behind this session: browser_session or native_access',
    example: 'browser_session',
  })
  credentialPurpose!: string;
}

/**
 * DTO for sessions list response.
 */
export class SessionListData {
  @ApiProperty({
    description: 'List of user sessions',
    type: [SessionDto],
  })
  sessions!: SessionDto[];

  @ApiProperty({
    description: 'Total number of sessions',
    example: 3,
  })
  total!: number;
}
