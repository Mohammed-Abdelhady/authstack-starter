import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { NATIVE_LIFECYCLE_LIMITS } from '../../constants/native-lifecycle.constants';

export class NativeEmailLinkVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NATIVE_LIFECYCLE_LIMITS.EMAIL_TOKEN)
  @Matches(/^[A-Za-z0-9_-]+$/u)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(NATIVE_LIFECYCLE_LIMITS.STATE)
  state!: string;
}
