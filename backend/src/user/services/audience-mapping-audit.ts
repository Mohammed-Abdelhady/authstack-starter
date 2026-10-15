import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { configuredAccountAudiences } from '../../config/utils/application-audiences';
import { AudienceMappingStore } from '../stores/audience-mapping.store';

@Injectable()
export class AudienceMappingAudit {
  constructor(
    private readonly config: ConfigService,
    private readonly runner: UnitOfWorkRunner,
    private readonly store: AudienceMappingStore,
  ) {}

  async assertMapped(): Promise<void> {
    if (configuredAccountAudiences(this.config).length === 0) return;
    const missing = await this.runner.run((work) =>
      this.store.missingCounts(work),
    );
    if (missing.accounts === 0 && missing.roles === 0) return;
    throw new Error(
      `Application audience requires mapped data: ${missing.accounts} accounts and ${missing.roles} roles have no audience. Run pnpm --filter backend run audience:apply before enabling an application audience.`,
    );
  }
}
