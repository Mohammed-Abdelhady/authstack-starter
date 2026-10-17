import { ConfigService } from '@nestjs/config';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { AdminActivityService } from '../../src/admin/activity/admin-activity.service';
import { AdminEmailCancellationService } from '../../src/admin/services/users/admin-email-cancellation.service';
import { AdminUserAccessService } from '../../src/admin/services/users/admin-user-access.service';
import { StaffMutationRules } from '../../src/admin/services/staff-mutations/staff-mutation-rules';
import { LastAdminGuard } from '../../src/admin/services/staff-mutations/last-admin-guard';
import { AddressLedger } from '../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import type { UnitOfWork } from '../../src/common/persistence/unit-of-work';
import type { ActingSession } from '../../src/auth/proof/types/acting-session';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  arrangeAudiences,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import { staffClient } from '../utils/sdk/staff-browser-client';
import type { E2eApp } from '../utils/e2e-app';

export const WANTED_ADDRESS = 'cancelled-address@example.test';

export async function cancelFixture(e2e: E2eApp) {
  e2e.clock.set(TEST_NOW);
  const audience = await arrangeAudiences(e2e, ['*']);
  e2e.app.get(ConfigService).set('admin.strictMutations', true);
  const issued = await issueAudienceBrowser(e2e, audience.adminId);
  const client = staffClient(e2e, { issued });
  const current = await e2e.app
    .get(Sessions)
    .validateSessionWithoutExtendingIdle(issued.sessionToken);
  if (!current) throw new Error('The acting session is missing');
  const session: ActingSession = {
    sessionId: current.id,
    userId: current.userId,
    clientId: current.clientId,
    signedInAt: current.authenticatedAt,
  };
  return { audience, issued, client, session };
}

export async function beginStaffChange(
  e2e: E2eApp,
  fixture: Awaited<ReturnType<typeof cancelFixture>>,
  id = fixture.audience.staffId,
) {
  const current = await fixture.client.admin.accounts.get(id);
  await fixture.client.admin.accounts.update(id, {
    email: WANTED_ADDRESS,
    version: current.version,
  });
  const code = await e2e.mailedCode();
  const pending = await fixture.client.admin.accounts.get(id);
  return { code, pending };
}

export async function updateEvents(e2e: E2eApp, target: string) {
  const page = await e2e.app
    .get(AdminActivityService)
    .list({ target, action: 'account_updated', limit: 100 });
  return page.data;
}

export function cancellationWith(
  e2e: E2eApp,
  beforeWork: () => Promise<void>,
  afterWork?: () => void,
) {
  const real = e2e.app.get(UnitOfWorkRunner);
  const runner = new (class extends UnitOfWorkRunner {
    private first = true;
    async run<T>(work: (unit: UnitOfWork) => Promise<T>): Promise<T> {
      if (this.first) {
        this.first = false;
        await beforeWork();
      }
      return real.run(async (unit) => {
        const result = await work(unit);
        afterWork?.();
        return result;
      });
    }
  })();
  return new AdminEmailCancellationService({
    accounts: e2e.app.get(AdminAccountStore),
    access: e2e.app.get(AdminUserAccessService),
    runner,
    rules: e2e.app.get(StaffMutationRules),
    lastAdmin: e2e.app.get(LastAdminGuard),
    ledger: e2e.app.get(AddressLedger),
  });
}

export function cancellationRequest(
  fixture: Awaited<ReturnType<typeof cancelFixture>>,
  version: number,
  target = fixture.audience.staffId,
) {
  return {
    id: target,
    actorId: fixture.audience.adminId,
    actorRole: 'admin',
    actorPermissions: ['*'],
    session: fixture.session,
    version,
  };
}
