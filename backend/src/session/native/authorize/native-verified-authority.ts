import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { ApplicationRegistry } from '../../applications/application-registry';
import { ApplicationAccessStore } from '../../applications/application-access.store';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../constants/client-ids';
import {
  isAcceptableRedirectUri,
  matchesRegisteredRedirectUri,
} from '../../utils/oauth/redirect-uri.util';
import type {
  NativeAttempt,
  VerifiedNativeAccount,
} from '../../../auth/native/types/native-attempt';
import { assertAudienceAdmission } from '../../utils/authority/audience-admission';
import { expiredTransaction } from './native-authorization-result';
import { nativeRedirectPolicy } from './native-authorize-validation';

interface NativeVerifiedAuthorityInput {
  unitOfWork: UnitOfWork;
  attempt: NativeAttempt;
  principal: VerifiedNativeAccount;
  authEpoch: AuthEpochService;
  issuance: BrowserIssuanceStore;
  registry: ApplicationRegistry;
  grants: ApplicationAccessStore;
}

export async function assertNativeVerifiedAuthority(
  authority: NativeVerifiedAuthorityInput,
): Promise<void> {
  const { unitOfWork, attempt, principal } = authority;
  if (attempt.authEpoch !== authority.authEpoch.current())
    throw expiredTransaction();
  const account = await authority.issuance.readAccountForIssuance(
    unitOfWork,
    principal.userId,
  );
  if (
    !account ||
    account.isDeleted ||
    account.sessionVersion !== principal.userVersion
  )
    throw expiredTransaction();
  const application = await authority.registry.findClientIn(
    unitOfWork,
    attempt.clientId,
  );
  if (
    !application ||
    !application.enabled ||
    application.platform !== APPLICATION_PLATFORM.NATIVE ||
    application.clientType !== APPLICATION_CLIENT_TYPE.PUBLIC ||
    application.sessionVersion !== principal.clientVersion ||
    !isAcceptableRedirectUri(
      attempt.redirectUri,
      nativeRedirectPolicy(authority.authEpoch),
    ) ||
    !application.redirectUris.some((registered) =>
      matchesRegisteredRedirectUri(registered, attempt.redirectUri),
    )
  ) {
    throw expiredTransaction();
  }
  assertAudienceAdmission(account.accountAudience, application.accountAudience);
  const grant = await authority.grants.takeGrantForChange(
    unitOfWork,
    principal.userId,
    attempt.clientId,
  );
  if (
    (grant?.sessionVersion ?? null) !== principal.grantVersion ||
    grant?.allowed === false
  )
    throw expiredTransaction();
}
