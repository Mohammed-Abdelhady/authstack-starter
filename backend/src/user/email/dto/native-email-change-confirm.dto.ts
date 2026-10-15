import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ConfirmEmailChangeDto } from '../../../auth/dto/confirm-email-change.dto';
import { NATIVE_CLIENT_ID_MAX_LENGTH } from '../constants/own-email';

/**
 * Confirms a change from a mobile app, signed in or not. The client id must
 * name an enabled public native application.
 */
export class NativeEmailChangeConfirmDto extends ConfirmEmailChangeDto {
  @ApiProperty({
    description: 'The registered client id of the mobile app',
    example: 'com.example.app',
    maxLength: NATIVE_CLIENT_ID_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NATIVE_CLIENT_ID_MAX_LENGTH)
  clientId!: string;
}
