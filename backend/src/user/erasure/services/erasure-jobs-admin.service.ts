import { Injectable } from '@nestjs/common';
// feature:oauth-core:start
import { ProviderTokenStore } from '../../../auth/oauth/provider-tokens/stores/provider-token.store';
import { revocationView } from '../../../auth/oauth/provider-tokens/utils/revocation-view';
// feature:oauth-core:end
import { ERASURE_JOB_LIST_LIMIT } from '../constants/erasure.constants';
import type {
  ErasureJobsListDto,
  ErasureJobViewDto,
} from '../dto/erasure-jobs.dto';
import { ErasureJobStore } from '../stores/erasure-job.store';
import type { ErasureJob } from '../types/erasure';

function jobView(job: ErasureJob): ErasureJobViewDto {
  return {
    id: job.id,
    accountId: job.userId,
    step: job.step,
    attempts: job.attempts,
    ...(job.failureCode !== null && { failureCode: job.failureCode }),
    ...(job.failedAt && { failedAt: job.failedAt.toISOString() }),
    ...(job.nextAttemptAt && {
      nextAttemptAt: job.nextAttemptAt.toISOString(),
    }),
    startedAt: job.startedAt.toISOString(),
  };
}

/** What staff see of erasures that need a person: open jobs, flagged revocations. */
@Injectable()
export class ErasureJobsAdminService {
  constructor(
    private readonly jobs: ErasureJobStore,
    private readonly revocations: ProviderTokenStore, // feature:oauth-core
  ) {}

  async list(): Promise<ErasureJobsListDto> {
    const list: ErasureJobsListDto = {
      erasureJobs: (await this.jobs.listOpen(ERASURE_JOB_LIST_LIMIT)).map(
        jobView,
      ),
      revocations: [],
    };
    // feature:oauth-core:start
    list.revocations = (
      await this.revocations.listFlagged(ERASURE_JOB_LIST_LIMIT)
    ).map(revocationView);
    // feature:oauth-core:end
    return list;
  }
}
