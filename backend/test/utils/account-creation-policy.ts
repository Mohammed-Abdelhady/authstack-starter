import type { RoleAudience } from '../../src/host/types/host-role.type';
import { IssuanceApplications } from '../../src/session/issuance/issuance-applications';
import type { INestApplication } from '@nestjs/common';
import { UnitOfWork } from '../../src/common/persistence/unit-of-work';
import { AccountCreationPolicy } from '../../src/auth/services/registration/account-creation-policy';
import { AccountCreationRefusedError } from '../../src/auth/services/registration/account-creation-refused.error';
import type { AccountCreationRequest } from '../../src/auth/types/account-creation';

export class SwitchableAccountCreationPolicy extends AccountCreationPolicy {
  refused = false;
  readonly calls: {
    request: AccountCreationRequest;
    unitOfWork: UnitOfWork;
  }[] = [];

  constructor(applications: IssuanceApplications) {
    super(applications);
  }

  override assertMayCreate(
    request: AccountCreationRequest,
    unitOfWork: UnitOfWork,
  ): Promise<RoleAudience | undefined> {
    this.calls.push({ request: { ...request }, unitOfWork });
    if (this.refused) {
      return Promise.reject(new AccountCreationRefusedError());
    }
    return super.assertMayCreate(request, unitOfWork);
  }
}

export function installAccountCreationPolicy(
  app: INestApplication,
): SwitchableAccountCreationPolicy {
  const policy = new SwitchableAccountCreationPolicy(
    app.get(IssuanceApplications),
  );
  jest
    .spyOn(app.get(AccountCreationPolicy), 'assertMayCreate')
    .mockImplementation((request, unitOfWork) =>
      policy.assertMayCreate(request, unitOfWork),
    );
  return policy;
}
