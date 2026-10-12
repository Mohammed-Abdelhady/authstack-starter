import { ApiResponse } from '../../common/dto/api-response.dto';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Admin user DTO with all user fields (excluding password).
 */
export class AdminUserDto {
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

  @ApiProperty({
    description:
      'Address an admin asked the account to move to. The account keeps ' +
      'its own address until this one confirms its code. Absent when no ' +
      'address waits.',
    example: 'new.address@example.com',
    required: false,
  })
  pendingEmail?: string;

  @ApiProperty({
    description: 'Whether the user account is deleted (soft delete)',
    example: false,
  })
  isDeleted!: boolean;

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

/**
 * Pagination metadata for user list responses.
 */
export class PaginationMetadata {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Items per page',
    example: 10,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of items',
    example: 100,
  })
  total!: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 10,
  })
  totalPages!: number;
}

/**
 * Response data for paginated user list.
 */
export class UserListData {
  @ApiProperty({
    description: 'List of users',
    type: [AdminUserDto],
  })
  data!: AdminUserDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetadata,
  })
  pagination!: PaginationMetadata;
}

/**
 * Response wrapper for paginated user list.
 */
export class UserListResponseDto {
  static success(
    input: UserListData,
    message?: string,
  ): ApiResponse<UserListData> {
    return ApiResponse.success(input, message);
  }
}

/**
 * Response wrapper for single user details.
 */
export class UserDetailResponseDto {
  static success(
    data: AdminUserDto,
    message?: string,
  ): ApiResponse<AdminUserDto> {
    return ApiResponse.success(data, message);
  }
}
