import { ApiProperty } from '@nestjs/swagger';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { ActivityDetails } from '../../../session/events/types/activity-event';
import { PaginationMetadata } from '../../dto/admin-user-response.dto';

export class AdminActivityRoleAssignmentDto {
  @ApiProperty()
  declare assignedRoleId: string;

  @ApiProperty({ type: String, nullable: true })
  declare previousRoleId: string | null;
}

export class AdminActivityDto {
  @ApiProperty()
  declare id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  declare occurredAt: Date;

  @ApiProperty()
  declare action: string;

  @ApiProperty()
  declare outcome: string;

  @ApiProperty({ type: String, nullable: true })
  declare actorId: string | null;

  @ApiProperty({ type: String, nullable: true })
  declare targetUserId: string | null;

  @ApiProperty({ type: String, nullable: true })
  declare clientId: string | null;

  @ApiProperty({ type: String, nullable: true })
  declare sessionId: string | null;

  @ApiProperty({
    type: Object,
    additionalProperties: {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'array', items: { type: 'string' } },
      ],
    },
  })
  declare details: ActivityDetails;

  @ApiProperty({ type: AdminActivityRoleAssignmentDto, nullable: true })
  declare roleAssignment: AdminActivityRoleAssignmentDto | null;
}

export class AdminActivityListData {
  @ApiProperty({ type: [AdminActivityDto] })
  declare data: AdminActivityDto[];

  @ApiProperty({ type: PaginationMetadata })
  declare pagination: PaginationMetadata;
}

export class AdminActivityResponseDto extends ApiResponse<AdminActivityListData> {
  @ApiProperty({ type: AdminActivityListData })
  declare data: AdminActivityListData;
}
