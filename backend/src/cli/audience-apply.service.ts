import { Injectable } from '@nestjs/common';
import { UnitOfWorkRunner } from '../common/persistence/unit-of-work';
import { SessionRevoker } from '../session/revocation/session-revoker';
import { AudienceMappingStore } from '../user/stores/audience-mapping.store';
import type {
  AudienceApplyOptions,
  AudienceApplySummary,
  AudienceMappingPlan,
} from './types/audience-apply';
import { audienceMappingPlan } from './utils/audience-mapping-plan';

@Injectable()
export class AudienceApplyService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly store: AudienceMappingStore,
    private readonly revoker: SessionRevoker,
  ) {}

  async apply(options: AudienceApplyOptions): Promise<AudienceApplySummary> {
    const plan = await this.planAndMapRoles(options);
    let revokedSessions = 0;
    if (!options.dryRun) {
      // One unit of work per account keeps every transaction short. A rerun
      // after a failure finds the mapped accounts done and maps the rest.
      for (const { account, audience } of plan.accounts) {
        revokedSessions += await this.runner.run(async (work) => {
          await this.store.mapAccount(work, account, audience);
          return this.revoker.revokeAllForUserIn(work, account.id);
        });
      }
    }
    return {
      dryRun: options.dryRun,
      roles: plan.roles.length,
      accounts: plan.accounts.length,
      revokedSessions,
    };
  }

  /** Every refusal is decided, and the roles mapped, before an account changes. */
  private planAndMapRoles(
    options: AudienceApplyOptions,
  ): Promise<AudienceMappingPlan> {
    return this.runner.run(async (work) => {
      const plan = audienceMappingPlan(
        await this.store.snapshot(work, { lock: !options.dryRun }),
        options.roles,
      );
      if (!options.dryRun) {
        for (const { role, audience } of plan.roles) {
          await this.store.mapRole(work, role, audience);
        }
      }
      return plan;
    });
  }
}
