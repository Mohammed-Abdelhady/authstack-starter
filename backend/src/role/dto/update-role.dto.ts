import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';
import { RoleLevelProperty } from './role-level.decorator';

/**
 * DTO for updating an existing role.
 * All fields are optional, name cannot be changed for protected roles.
 * The level keeps its own rule, because PartialType would let `null` through.
 */
export class UpdateRoleDto extends PartialType(
  OmitType(CreateRoleDto, ['level'] as const),
) {
  @RoleLevelProperty()
  level?: number;
}
