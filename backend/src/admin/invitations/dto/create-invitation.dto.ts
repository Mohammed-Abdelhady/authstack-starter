import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';
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

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(transformTrimmedName)
  @NamePolicy()
  name?: string;
}
