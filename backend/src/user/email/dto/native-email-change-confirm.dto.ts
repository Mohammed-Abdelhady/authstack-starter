import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ConfirmEmailChangeDto } from '../../../auth/dto/confirm-email-change.dto';
import {
  NATIVE_CLIENT_ID_MAX_LENGTH,
  NATIVE_CLIENT_ID_PATTERN,
} from '../../../session/constants/client-ids';

/**
 * Confirms a change from a mobile app, signed in or not. The client id must
 * name an enabled public native application, in the shape the registry takes.
 */
export class NativeEmailChangeConfirmDto extends ConfirmEmailChangeDto {
  @ApiProperty({
    description: 'The registered client id of the mobile app',
    example: 'com.example.app',
    maxLength: NATIVE_CLIENT_ID_MAX_LENGTH,
    pattern: NATIVE_CLIENT_ID_PATTERN.source,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NATIVE_CLIENT_ID_MAX_LENGTH)
  @Matches(NATIVE_CLIENT_ID_PATTERN)
  clientId!: string;
}
