import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffVersion } from './staff-version.decorator';

/**
 * DTO for updating user activation status.
 */
export class UpdateUserStatusDto {
  @ApiProperty({
    description: 'User activation status (true = active, false = deleted)',
    example: false,
  })
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional({
    description: 'Reason for status change',
    example: 'Account closed per user request',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @StaffVersion()
  version?: number;
}
