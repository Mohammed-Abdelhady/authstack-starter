import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { IssuancePolicy } from './types/application-policy';

/** Defaults to today's IssuanceApplications read; plan 1 adds application policy. */
export abstract class ApplicationPolicyReader {
  abstract requireEnabled(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuancePolicy>;
}
