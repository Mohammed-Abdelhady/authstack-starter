import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../../host/types/host-role.type';
import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { SIGN_UP_POLICY } from '../../../config/constants/host-contracts';
import { IssuanceApplications } from '../../../session/issuance/issuance-applications';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import type { AccountCreationRequest } from '../../types/account-creation';
import { SelfSignUpRefusedError } from './self-sign-up-refused.error';

@Injectable()
export class AccountCreationPolicy {
  constructor(private readonly applications: IssuanceApplications) {}

  /** Read the persisted policy even on a process with older configuration. */
  async assertMayCreate(
    request: AccountCreationRequest,
    unitOfWork: UnitOfWork,
  ): Promise<RoleAudience | undefined> {
    if (
      request.method === ACCOUNT_CREATION_METHOD.STAFF ||
      request.method === ACCOUNT_CREATION_METHOD.INVITATION || // feature:invitations
      request.application === null
    ) {
      return undefined;
    }
    const application = await this.applications.requireEnabled(
      unitOfWork,
      request.application,
    );
    // No self sign-up method gives the new account a passkey, so an
    // application that requires one could never let that account in.
    if (
      application.signUp === SIGN_UP_POLICY.CLOSED ||
      application.requirePasskey === true
    ) {
      throw new SelfSignUpRefusedError();
    }
    if (application.accountAudience !== undefined) {
      return application.accountAudience;
    }
    return (await this.applications.hasAccountAudience(unitOfWork))
      ? ROLE_AUDIENCE.CUSTOMER
      : undefined;
  }
}
