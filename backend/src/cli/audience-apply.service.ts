import { Injectable } from '@nestjs/common';
import { UnitOfWorkRunner } from '../common/persistence/unit-of-work';
import { SessionRevoker } from '../session/revocation/session-revoker';
import { AudienceMappingStore } from '../user/stores/audience-mapping.store';
import type {
  AudienceApplyOptions,
  AudienceApplySummary,
} from './types/audience-apply';
import { audienceMappingPlan } from './utils/audience-mapping-plan';

@Injectable()
export class AudienceApplyService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly store: AudienceMappingStore,
    private readonly revoker: SessionRevoker,
  ) {}

  apply(options: AudienceApplyOptions): Promise<AudienceApplySummary> {
    return this.runner.run(async (work) => {
      const plan = audienceMappingPlan(
        await this.store.snapshot(work, { lock: !options.dryRun }),
        options.roles,
      );
      let revokedSessions = 0;
      if (!options.dryRun) {
        for (const { role, audience } of plan.roles) {
          await this.store.mapRole(work, role, audience);
        }
        for (const { account, audience } of plan.accounts) {
          await this.store.mapAccount(work, account, audience);
          revokedSessions += await this.revoker.revokeAllForUserIn(
            work,
            account.id,
          );
        }
      }
      return {
        dryRun: options.dryRun,
        roles: plan.roles.length,
        accounts: plan.accounts.length,
        revokedSessions,
      };
    });
  }
}
