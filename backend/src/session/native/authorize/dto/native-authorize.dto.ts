import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Read the raw body because implicit conversion would turn a number into a string.
function rawBodyValue({ obj, key }: TransformFnParams): unknown {
  const raw: unknown = obj?.[key];
  return raw;
}

export class NativeAuthorizeActionDto {
  @ApiProperty({
    description: 'Identifier returned by the native authorize start route',
    example: '65bd2588-08ef-4489-9b07-543ca8124319',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  transactionId!: string;

  @ApiProperty({
    description:
      'Id of the account the consent page displayed. When it differs from the signed-in account the action answers 409 NATIVE_AUTHORIZE_ACCOUNT_MISMATCH and the request stays pending.',
    example: '65f1c0a4e4b0a1b2c3d4e5f6',
  })
  @Transform(rawBodyValue)
  @IsString()
  expectedUserId!: string;
}
