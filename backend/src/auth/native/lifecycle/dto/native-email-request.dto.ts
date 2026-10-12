import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { NATIVE_LIFECYCLE_LIMITS } from '../../constants/native-lifecycle.constants';

export class NativeEmailRequestDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(NATIVE_LIFECYCLE_LIMITS.EMAIL)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;
}
