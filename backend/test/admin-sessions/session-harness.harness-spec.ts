import { ConfigService } from '@nestjs/config';
import { AdminSessionAccessService } from '../../src/admin/sessions/admin-session-access.service';
import { AdminAudienceScopes } from '../../src/admin/services/users/admin-audience-scopes';
import { AudiencePolicy } from '../../src/session/applications/audience-policy';
import { AdminSessionsService } from '../../src/admin/sessions/admin-sessions.service';
import { AdminUserAccessService } from '../../src/admin/services/users/admin-user-access.service';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { RoleHierarchyService } from '../../src/role/services/role-hierarchy.service';
import { RoleCatalogStore } from '../../src/role/stores/role-catalog.store';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import { RerunPause } from '../../src/common/persistence/unit-of-work';
import { SecurityEventStore } from '../../src/session/events/security-event.store';
import { AuthorityContractHarness } from '../utils/session/authority-contract/authority-contract-harness';
import { rerunAtOnce } from '../utils/session/issuance-contract/issuance-contract-support';
import { testStaffMutationPolicy } from '../utils/admin/staff-mutation-test-kit';

export interface StaffSessionHarness {
  authority: AuthorityContractHarness;
  access: AdminSessionAccessService;
  events: SecurityEventStore;
  service(pause?: RerunPause): AdminSessionsService;
  seedRoles(): Promise<void>;
  patchAccount(
    id: string,
    patch: { role?: string; permissions?: string[]; deleted?: boolean },
  ): Promise<void>;
}

export function staffSessionServices(
  authority: AuthorityContractHarness,
  stores: {
    accounts: AdminAccountStore;
    roles: RoleChangeStore;
    catalog: RoleCatalogStore;
  },
) {
  const access = new AdminSessionAccessService(
    stores.accounts,
    new AdminUserAccessService(
      stores.accounts,
      new RoleHierarchyService(stores.catalog),
      new AdminAudienceScopes(
        new AudiencePolicy(new ConfigService({})),
        stores.roles,
      ),
    ),
    stores.roles,
    testStaffMutationPolicy(),
  );
  return {
    access,
    service: (pause: RerunPause = rerunAtOnce) =>
      new AdminSessionsService(
        access,
        authority.validator(),
        authority.revoker(pause),
        authority.issuance.runner(pause),
        authority.ids,
      ),
  };
}

export async function staffActor(
  harness: StaffSessionHarness,
  permissions = ['*'],
): Promise<string> {
  const id = await harness.authority.issuance.seedAccount();
  await harness.patchAccount(id, { role: 'admin', permissions });
  return id;
}
