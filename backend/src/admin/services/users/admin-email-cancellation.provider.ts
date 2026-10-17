import { AddressLedger } from '../../../common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { LastAdminGuard } from '../staff-mutations/last-admin-guard';
import { StaffMutationRules } from '../staff-mutations/staff-mutation-rules';
import { AdminUserAccessService } from './admin-user-access.service';
import { AdminEmailCancellationService } from './admin-email-cancellation.service';

export const ADMIN_EMAIL_CANCELLATION_PROVIDER = {
  provide: AdminEmailCancellationService,
  inject: [
    AdminAccountStore,
    AdminUserAccessService,
    UnitOfWorkRunner,
    StaffMutationRules,
    LastAdminGuard,
    AddressLedger,
  ],
  useFactory: (
    ...[accounts, access, runner, rules, lastAdmin, ledger]: [
      AdminAccountStore,
      AdminUserAccessService,
      UnitOfWorkRunner,
      StaffMutationRules,
      LastAdminGuard,
      AddressLedger,
    ]
  ) =>
    new AdminEmailCancellationService({
      accounts,
      access,
      runner,
      rules,
      lastAdmin,
      ledger,
    }),
};
