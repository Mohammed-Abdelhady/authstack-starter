import {
  IsNotEmpty,
  IsString,
  Matches,
  NotEquals,
  IsNotIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  PERMISSION_REGEX,
  RESERVED_PERMISSIONS,
  RESERVED_PERMISSION_MESSAGE,
  WILDCARD_PERMISSION,
} from '../../common/constants/permissions';

/**
 * DTO for adding a permission to a user.
 * The wildcard is a role-level grant and is refused here.
 */
export class AddPermissionDto {
  @ApiProperty({
    description: 'Permission to add (format: resource:action[:scope])',
    example: 'users:read:all',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(PERMISSION_REGEX, {
    message: 'Permission must be in the format resource:action[:scope]',
  })
  @IsNotIn([...RESERVED_PERMISSIONS], {
    message: RESERVED_PERMISSION_MESSAGE,
  })
  @NotEquals(WILDCARD_PERMISSION, {
    message: 'The wildcard permission cannot be granted to a single user',
  })
  permission!: string;
}
