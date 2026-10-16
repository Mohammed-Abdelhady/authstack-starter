import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErasureJobViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The account being erased, as an id only' })
  accountId!: string;

  @ApiProperty({ enum: ['erasing', 'hook_done'] })
  step!: string;

  @ApiProperty()
  attempts!: number;

  @ApiPropertyOptional({
    description: 'A code: `hook_failed`, `hook:<code>` or `erase_failed`',
  })
  failureCode?: string;

  @ApiPropertyOptional()
  failedAt?: string;

  @ApiPropertyOptional({ description: 'When the next try may run' })
  nextAttemptAt?: string;

  @ApiProperty()
  startedAt!: string;
}

export class ProviderRevocationViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'apple' })
  provider!: string;

  @ApiPropertyOptional({
    description:
      'The account it was for, as an id only. Absent for `unclaimed`: a token kept at a sign-in that made no account',
  })
  accountId?: string;

  @ApiProperty({ enum: ['erasure', 'unlink', 'unclaimed'] })
  reason!: string;

  @ApiProperty()
  attempts!: number;

  @ApiPropertyOptional()
  failureCode?: string;

  @ApiPropertyOptional()
  flaggedAt?: string;

  @ApiPropertyOptional()
  nextAttemptAt?: string;

  @ApiProperty()
  createdAt!: string;
}

export class ErasureJobsListDto {
  @ApiProperty({
    type: [ErasureJobViewDto],
    description: 'Erasures that have started and not finished, newest first',
  })
  erasureJobs!: ErasureJobViewDto[];

  @ApiProperty({
    type: [ProviderRevocationViewDto],
    description: 'Provider revocations flagged after five failures',
  })
  revocations!: ProviderRevocationViewDto[];
}
