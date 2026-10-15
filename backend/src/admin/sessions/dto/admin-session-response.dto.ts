import { ApiProperty } from '@nestjs/swagger';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import {
  ROLE_AUDIENCE,
  RoleAudience,
} from '../../../host/types/host-role.type';
import { SessionDto } from '../../../user/dto/user-profile.dto';

export class AdminSessionDto extends SessionDto {
  @ApiProperty({ description: 'Application that owns this session' })
  declare clientId: string;
}

export class AdminSessionListData {
  @ApiProperty({ enum: Object.values(ROLE_AUDIENCE) })
  declare targetClass: RoleAudience;

  @ApiProperty({ type: [AdminSessionDto] })
  declare sessions: AdminSessionDto[];

  @ApiProperty()
  declare total: number;
}

export class AdminSessionListResponseDto extends ApiResponse<AdminSessionListData> {
  @ApiProperty({ type: AdminSessionListData })
  declare data: AdminSessionListData;
}
