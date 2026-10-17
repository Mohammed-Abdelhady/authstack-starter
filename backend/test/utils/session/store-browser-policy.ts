import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { AuthEpochService } from '../../../src/common/services/auth-epoch.service';
import {
  ApplicationRegistryStore,
  type ApplicationPolicyWrite,
} from '../../../src/session/applications/application-registry.store';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import type { E2eApp } from '../e2e-app';

/** Fixtures can retain the version when testing admission separately. */
export async function storeBrowserPolicy(
  e2e: E2eApp,
  clientId: string,
  policy: Pick<ApplicationPolicyWrite, 'requirePasskey' | 'accountAudience'>,
  advanceVersion = true,
): Promise<void> {
  const store = e2e.app.get(ApplicationRegistryStore);
  const environment = e2e.app.get(AuthEpochService).environment();
  await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
    const [stored] = await store.takeRegistrations(work, environment, [
      clientId,
    ]);
    const application = await store.findClient(work, environment, clientId);
    if (!stored || !application) {
      throw new Error(`Stored application ${clientId} is missing`);
    }
    const version = stored.policyVersion ?? 0;
    await store.storeBrowserRegistration(work, {
      ...application,
      environment,
      expectedPolicyVersion: version,
      policyVersion: version + Number(advanceVersion),
      accountAudience: application.accountAudience ?? null,
      signInMethods: application.signInMethods ?? null,
      initialAudiences: [DEFAULT_API_AUDIENCE],
      initialScopes: [...application.allowedScopes],
      ...policy,
    });
  });
}
