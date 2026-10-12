import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { UserRole } from '../../../user/enums/user-role.enum';
import { RoleChangeStore } from '../../stores/role-change.store';
import { RoleSweepStore } from '../../stores/role-sweep.store';
import {
  ROLE_PENDING_SWEEP_LIMIT,
  ROLE_SWEEP_BOOTSTRAP_BUDGET_MS,
  ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED,
  ROLE_SWEEP_BOOTSTRAP_FAILED,
  ROLE_SWEEP_BOOTSTRAP_FINISHED,
  ROLE_SWEEP_BOOTSTRAP_LIMIT,
} from '../../../common/constants/roles';
import { repairPendingRoleSweeps } from '../../sweeps/role-pending-repair';
import { RoleSweepStores } from '../../sweeps/role-holder-sweep';
import { Clock } from '../../../common/services/clock';
import { describeStoreFailure } from '../../utils/role-failure.util';

@Injectable()
export class RoleSweepBootstrapService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RoleSweepBootstrapService.name);
  private task: Promise<void> = Promise.resolve();
  private stopping = false;

  private readonly stores: RoleSweepStores;

  constructor(
    runner: UnitOfWorkRunner,
    changes: RoleChangeStore,
    private readonly sweeps: RoleSweepStore,
    private readonly clock: Clock,
  ) {
    this.stores = { runner, changes, sweeps };
  }

  onApplicationBootstrap(): void {
    this.stopping = false;
    const deadline =
      this.clock.now().getTime() + ROLE_SWEEP_BOOTSTRAP_BUDGET_MS;
    this.task = this.repair(deadline)
      .catch((error: unknown) => {
        this.logger.error({
          event: ROLE_SWEEP_BOOTSTRAP_FAILED,
          error: describeStoreFailure(error),
        });
      })
      .finally(() => {
        this.logger.debug({ event: ROLE_SWEEP_BOOTSTRAP_FINISHED });
      });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.task;
  }

  private async repair(deadline: number): Promise<void> {
    let budgetLogged = false;
    const shouldStop = (): boolean => {
      if (this.stopping) return true;
      if (this.clock.now().getTime() < deadline) return false;
      if (!budgetLogged) {
        budgetLogged = true;
        this.logger.warn({
          event: ROLE_SWEEP_BOOTSTRAP_BUDGET_EXHAUSTED,
          budgetMs: ROLE_SWEEP_BOOTSTRAP_BUDGET_MS,
        });
      }
      return true;
    };
    const owners = await this.sweeps.listSweepOwners(
      ROLE_SWEEP_BOOTSTRAP_LIMIT,
    );
    const attempted = new Set<string>();
    for (const owner of owners) {
      if (shouldStop()) return;
      for (const ref of owner.pendingHolderSweeps.slice(
        0,
        ROLE_PENDING_SWEEP_LIMIT,
      ))
        attempted.add(`${ref.roleId}:${ref.previousSlug}`);
      await repairPendingRoleSweeps(this.stores, {
        ownerId: owner.id,
        refs: owner.pendingHolderSweeps.slice(0, ROLE_PENDING_SWEEP_LIMIT),
        logger: this.logger,
        shouldStop,
      });
      if (shouldStop()) return;
      // Rotate owners that still have pending work behind older unattempted owners.
      await this.sweeps.rotateSweepOwner(owner.id, this.clock.now());
    }
    if (shouldStop()) return;
    // Delete references also survive a crash before the default role can record them.
    const deleted = await this.sweeps.listPendingDeletions(
      ROLE_SWEEP_BOOTSTRAP_LIMIT,
    );
    if (deleted.length === 0 || shouldStop()) return;
    const fallback = await this.sweeps.findSweepOwnerBySlug(UserRole.USER);
    if (!fallback)
      throw new Error('Default role is missing during startup repair');
    for (const ref of deleted) {
      if (shouldStop()) return;
      if (attempted.has(`${ref.roleId}:${ref.previousSlug}`)) continue;
      await repairPendingRoleSweeps(this.stores, {
        ownerId: fallback.id,
        refs: [ref],
        recorded: fallback.pendingHolderSweeps.some(
          (pending) => pending.roleId === ref.roleId,
        ),
        logger: this.logger,
        shouldStop,
      });
    }
  }
}
