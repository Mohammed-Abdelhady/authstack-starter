import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleLevelProperty } from './role-level.decorator';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../host/types/host-role.type';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Display name of the role',
    example: 'Content Editor',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9\s-]+$/, {
    message: 'Role name can only contain letters, numbers, spaces, and hyphens',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the role',
    example: 'Can create and edit content',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({
    description: 'Array of permission strings',
    example: ['posts:create', 'posts:update', 'posts:read:all'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: 'Role must have at least one permission' })
  @Matches(/^([a-z-]+:[a-z-]+(:[a-z-]+)?|\*)$/, {
    each: true,
    message:
      'Permission must be in format resource:action[:scope] or wildcard *',
  })
  permissions!: string[];

  @ApiPropertyOptional({ enum: Object.values(ROLE_AUDIENCE) })
  @IsOptional()
  @IsEnum(ROLE_AUDIENCE)
  audience?: RoleAudience;

  @RoleLevelProperty()
  level?: number;
}
