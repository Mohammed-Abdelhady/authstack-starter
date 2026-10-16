import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { AuthEpochService } from '../../../src/common/services/auth-epoch.service';
import { ApplicationRegistryStore } from '../../../src/session/applications/application-registry.store';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import type { E2eApp } from '../e2e-app';

export async function storeNativePolicy(
  e2e: E2eApp,
  clientId: string,
  policyVersion: number,
): Promise<void> {
  const store = e2e.app.get(ApplicationRegistryStore);
  const environment = e2e.app.get(AuthEpochService).environment();
  await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
    await store.takeRegistrations(work, environment, [clientId]);
    const application = await store.findClient(work, environment, clientId);
    if (!application) throw new Error('native application is missing');
    await store.storeNativeRegistration(work, {
      ...application,
      environment,
      audiences: [DEFAULT_API_AUDIENCE],
      policy: application.policy,
      accountAudience: application.accountAudience ?? null,
      policyVersion,
      endsSessions: false,
    });
  });
}
