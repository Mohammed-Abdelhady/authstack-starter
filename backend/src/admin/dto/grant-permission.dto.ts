import { AddPermissionDto } from '../../user/dto/add-permission.dto';
import { StaffVersion } from './staff-version.decorator';

/** A direct grant from the admin area, with the account version it was read at. */
export class GrantPermissionDto extends AddPermissionDto {
  @StaffVersion()
  version?: number;
}
