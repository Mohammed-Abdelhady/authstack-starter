import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { IssuanceApplication } from './browser-issuance.store';

/**
 * The application registry as sign-in sees it. Whoever implements it owns the
 * rules: an unregistered client is `APPLICATION_NOT_FOUND`, a disabled one is
 * `APPLICATION_DISABLED`. The read happens inside the unit of work.
 */
export abstract class IssuanceApplications {
  abstract requireEnabled(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuanceApplication>;
}
