import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { AccountCreationRequest } from '../../types/account-creation';

/** Creation checks join the insert's transaction so later rules can read its state. */
@Injectable()
export class AccountCreationPolicy {
  assertMayCreate(
    _request: AccountCreationRequest,
    _unitOfWork: UnitOfWork,
  ): Promise<void> {
    return Promise.resolve();
  }
}
