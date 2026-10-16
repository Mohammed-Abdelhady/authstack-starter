import type { ProviderRevocationViewDto } from '../../../../user/erasure/dto/erasure-jobs.dto';
import type { ProviderRevocationJob } from '../types/provider-tokens';

/** A job as staff see it. The token never leaves the store. */
export function revocationView(
  job: ProviderRevocationJob,
): ProviderRevocationViewDto {
  return {
    id: job.id,
    provider: job.provider,
    ...(job.userId !== null && { accountId: job.userId }),
    reason: job.reason,
    attempts: job.attempts,
    ...(job.failureCode !== null && { failureCode: job.failureCode }),
    ...(job.flaggedAt && { flaggedAt: job.flaggedAt.toISOString() }),
    ...(job.nextAttemptAt && {
      nextAttemptAt: job.nextAttemptAt.toISOString(),
    }),
    createdAt: job.createdAt.toISOString(),
  };
}
