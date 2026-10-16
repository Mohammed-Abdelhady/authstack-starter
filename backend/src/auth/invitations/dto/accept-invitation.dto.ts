import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { INVITATION_MAX_TOKEN_LENGTH } from '../constants/invitations';

export class AcceptInvitationDto {
  @ApiProperty({
    description: 'One-time token from the invitation link fragment',
    maxLength: INVITATION_MAX_TOKEN_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(INVITATION_MAX_TOKEN_LENGTH)
  token!: string;
}
