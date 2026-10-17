import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RoleAudience } from '../../../host/types/host-role.type';
import { INVITATION_STATUS } from '../../../auth/invitations/constants/invitations';
import type { InvitationStatus } from '../../../auth/invitations/types/invitation';

export class AdminInvitationDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional() name?: string;
  @ApiProperty() role!: string;
  @ApiPropertyOptional() audience?: RoleAudience;
  @ApiProperty({ enum: Object.values(INVITATION_STATUS) })
  status!: InvitationStatus;
  @ApiPropertyOptional() invitedBy?: string;
  @ApiProperty() expiresAt!: Date;
  @ApiPropertyOptional() acceptedAt?: Date;
  @ApiPropertyOptional() revokedAt?: Date;
  @ApiProperty() createdAt!: Date;
}
