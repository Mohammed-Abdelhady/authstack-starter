import { IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ROLE_SLUG_MAX_LENGTH,
  ROLE_SLUG_MESSAGE,
  ROLE_SLUG_REGEX,
} from '../../common/constants/roles';
import { StaffVersion } from './staff-version.decorator';

/**
 * DTO for updating user role.
 * Any existing role slug is accepted here, including custom ones. The service
 * checks that the role exists and that the actor outranks it.
 */
export class UpdateUserRoleDto {
  @ApiProperty({
    description:
      'Role slug to assign. Must exist and sit below the actor role level. ' +
      'ADMIN cannot be assigned through the API.',
    example: 'manager',
  })
  @IsString()
  @MaxLength(ROLE_SLUG_MAX_LENGTH)
  @Matches(ROLE_SLUG_REGEX, { message: ROLE_SLUG_MESSAGE })
  role!: string;

  @StaffVersion()
  version?: number;
}
