import { Injectable } from '@nestjs/common';
import { AdminAccountStore } from '../../../admin/stores/admin-account.store';
import { AdminRosterStore } from '../../../admin/stores/admin-roster.store';
import {
  USER_SCOPE_ACTION,
  USER_SCOPE_PERMISSIONS,
} from '../../../admin/constants/user-scope-permissions';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  AddressLedger,
  ACCOUNT_RESERVATION_RESULT,
} from '../../../common/persistence/address-ledger';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  canModifyLevel,
  isAdminRole,
} from '../../../common/utils/role-hierarchy';
import { ROLE_AUDIENCE } from '../../../host/types/host-role.type';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import {
  assertCanGrant,
  assertFreshRolePermission,
} from '../../../role/utils/role-actor.util';
import { resolveRoleLevel } from '../../../role/utils/role.util';
import { StoredAccount } from '../../../user/stores/stored-account';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import { INVITATION_PURPOSE } from '../constants/invitations';
import { StoredInvitation } from '../types/invitation';
import { invalidInvitation } from '../utils/invitation-validity';

@Injectable()
export class InvitationAccountCreator {
  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly roster: AdminRosterStore,
    private readonly roles: RoleChangeStore,
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
  ) {}

  async create(
    unitOfWork: UnitOfWork,
    invitation: StoredInvitation,
    now: Date,
  ): Promise<StoredAccount> {
    const firstAdmin = invitation.purpose === INVITATION_PURPOSE.FIRST_ADMIN;
    if (firstAdmin) {
      await this.roster.lock(unitOfWork);
      if (await this.roster.hasActiveAdministrator(unitOfWork))
        throw invalidInvitation();
    }
    if (!invitation.roleSlug || !invitation.roleId) throw invalidInvitation();
    const role = await this.roles.readRoleAuthorityBySlug(
      unitOfWork,
      invitation.roleSlug,
    );
    if (
      !role ||
      role.id !== invitation.roleId ||
      role.audience !== invitation.audience ||
      (firstAdmin && !isAdminRole(role.slug))
    )
      throw invalidInvitation();
    if (!firstAdmin) {
      if (!invitation.invitedBy) throw invalidInvitation();
      try {
        const actor = await assertFreshRolePermission(
          this.roles,
          unitOfWork,
          invitation.invitedBy,
          USER_SCOPE_PERMISSIONS[USER_SCOPE_ACTION.CREATE][
            role.audience ?? ROLE_AUDIENCE.CUSTOMER
          ],
        );
        if (isAdminRole(role.slug)) {
          if (!actor.isAdmin) throw invalidInvitation();
        } else {
          // The level rule of issuing, with no wildcard exception.
          if (!canModifyLevel(actor, resolveRoleLevel(role)))
            throw invalidInvitation();
          assertCanGrant(actor, role.permissions);
        }
      } catch (error) {
        if (error instanceof AppException) throw invalidInvitation();
        throw error;
      }
    }
    await this.policy.assertMayCreate(
      {
        application: invitation.clientId,
        method: ACCOUNT_CREATION_METHOD.INVITATION,
      },
      unitOfWork,
    );
    await this.ledger.release(unitOfWork, {
      address: invitation.email,
      owner: invitation.id,
    });
    const reservation = await this.ledger.reserveForAccount(unitOfWork, {
      address: invitation.email,
      now,
    });
    if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN)
      throw invalidInvitation();
    const account = await this.accounts.insertAccount(unitOfWork, {
      email: invitation.email,
      name: invitation.name ?? invitation.email.split('@')[0],
      role: role.slug,
      audience: role.audience,
      locale: invitation.locale,
    });
    await this.ledger.finishAccountReservation(
      unitOfWork,
      reservation.reservation,
    );
    return account;
  }
}
