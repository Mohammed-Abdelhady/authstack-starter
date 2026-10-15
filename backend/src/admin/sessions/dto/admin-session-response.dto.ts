import { ApiProperty } from '@nestjs/swagger';
import { SessionDto } from '../../../user/dto/user-profile.dto';

export class AdminSessionDto extends SessionDto {
  @ApiProperty({ description: 'Application that owns this session' })
  declare clientId: string;
}

export class AdminSessionListData {
  @ApiProperty({ type: [AdminSessionDto] })
  declare sessions: AdminSessionDto[];

  @ApiProperty()
  declare total: number;
}
