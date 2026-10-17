import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../../host/types/host-role.type';
import { CreateUserDto } from '../../dto/create-user.dto';
import {
  NamePolicy,
  transformTrimmedName,
} from '../../../common/decorators/name-policy.decorator';

export class CreateInvitationDto extends PickType(CreateUserDto, [
  'email',
  'role',
  'locale',
] as const) {
  @ApiProperty({
    description:
      'Existing role slug. Inviting an administrator requires an administrator and a fresh act.',
  })
  declare role: string;

  @ApiPropertyOptional({
    description:
      'Observed role ID. Required with expectedAudience for a new strict write.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  expectedRoleId?: string;

  @ApiPropertyOptional({
    enum: Object.values(ROLE_AUDIENCE),
    nullable: true,
    description:
      'Observed audience. Null explicitly binds a role without an audience.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn([...Object.values(ROLE_AUDIENCE), null])
  expectedAudience?: RoleAudience | null;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(transformTrimmedName)
  @NamePolicy()
  name?: string;
}
