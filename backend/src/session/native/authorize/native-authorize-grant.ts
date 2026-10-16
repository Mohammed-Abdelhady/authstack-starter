import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { ApplicationAccessStore } from '../../applications/application-access.store';
import { RegisteredClient } from '../../applications/application-registry.store';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { expiredTransaction } from './native-authorization-result';

/** The stores an approval takes or creates the account's grant through. */
export interface NativeGrantStores {
  grants: ApplicationAccessStore;
  issuance: BrowserIssuanceStore;
}

export interface NativeGrantRequest {
  userId: string;
  application: RegisteredClient;
  /** The grant version an approval in the app saw; absent for a browser approval. */
  expectedVersion?: number | null;
}

/**
 * The account's grant for the application, created when it has none. A grant
 * that moved since the version the approval expected, or a blocked one, ends
 * the approval.
 */
export async function allowNativeGrant(
  unitOfWork: UnitOfWork,
  stores: NativeGrantStores,
  request: NativeGrantRequest,
): Promise<{ sessionVersion: number }> {
  const { userId, application, expectedVersion } = request;
  const existing = await stores.grants.takeGrantForChange(
    unitOfWork,
    userId,
    application.clientId,
  );
  if (
    expectedVersion !== undefined &&
    (existing?.sessionVersion ?? null) !== expectedVersion
  ) {
    throw expiredTransaction();
  }
  if (existing && !existing.allowed) {
    throw new AppException(
      ErrorCode.GRANT_BLOCKED,
      'Application access is blocked for this account',
      HttpStatus.FORBIDDEN,
    );
  }
  if (existing) {
    return existing;
  }
  return stores.issuance.createGrant(unitOfWork, {
    userId,
    clientId: application.clientId,
    allowedScopes: application.allowedScopes,
  });
}
