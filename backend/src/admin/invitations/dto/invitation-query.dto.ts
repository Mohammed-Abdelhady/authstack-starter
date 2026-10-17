import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { INVITATION_STATUS } from '../../../auth/invitations/constants/invitations';
import type { InvitationStatus } from '../../../auth/invitations/types/invitation';

export class InvitationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(INVITATION_STATUS) })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(Object.values(INVITATION_STATUS))
  status?: InvitationStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
