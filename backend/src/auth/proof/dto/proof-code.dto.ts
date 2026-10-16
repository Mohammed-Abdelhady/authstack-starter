import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class ProofCodeDto {
  @ApiProperty({
    description: 'The six-digit proof code',
    pattern: '^[0-9]{6}$',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/)
  code!: string;
}
