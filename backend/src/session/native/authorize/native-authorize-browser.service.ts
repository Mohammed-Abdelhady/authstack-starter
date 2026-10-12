import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { Clock } from '../../../common/services/clock';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../constants/client-ids';
import { ApplicationAccess } from '../../applications/application-access';
import { ApplicationRegistry } from '../../applications/application-registry';
import { RegisteredClient } from '../../applications/application-registry.store';
import {
  NativeAuthorizeTransactionDetails,
  OAUTH_ERROR,
} from '../oauth/native-oauth.types';
import { isAcceptableRedirectUri } from '../../utils/oauth/redirect-uri.util';
import type { RedirectUriPolicy } from '../../utils/oauth/redirect-uri.util';
import { matchesRegisteredRedirectUri } from '../../utils/oauth/redirect-uri.util';
import {
  AUTHORIZATION_DENIAL,
  NativeAuthorizationStore,
  PendingAuthorization,
} from './native-authorization.store';

@Injectable()
export class NativeAuthorizeBrowserService {
  constructor(
    private readonly store: NativeAuthorizationStore,
    private readonly registry: ApplicationRegistry,
    private readonly access: ApplicationAccess,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async getTransaction(
    userId: string,
    transactionId: string,
  ): Promise<NativeAuthorizeTransactionDetails> {
    this.assertNativeEnabled();
    const transaction = await this.store.findPending(
      transactionId,
      this.clock.now(),
    );
    if (!transaction) {
      throw expiredTransaction();
    }

    const application = await this.applicationForTransaction(transaction);

    return {
      applicationName: application.displayName,
      platform: application.platform,
      expiresAt: transaction.expiresAt.toISOString(),
      alreadyGranted: await this.access.isGrantAllowed(
        userId,
        transaction.clientId,
      ),
    };
  }

  async deny(transactionId: string): Promise<{ redirectUri: string }> {
    this.assertNativeEnabled();
    const pending = await this.store.findPending(
      transactionId,
      this.clock.now(),
    );
    if (!pending) {
      throw expiredTransaction();
    }
    await this.applicationForTransaction(pending);
    const denied = await this.store.deny(pending.id, {
      transactionId: pending.transactionId,
      redirectUri: pending.redirectUri,
      now: this.clock.now(),
    });
    if (denied.outcome !== AUTHORIZATION_DENIAL.DENIED) {
      throw expiredTransaction();
    }

    const target = new URL(denied.redirectUri);
    target.searchParams.set('error', OAUTH_ERROR.ACCESS_DENIED);
    target.searchParams.set('state', denied.state);
    return { redirectUri: target.toString() };
  }

  private async applicationForTransaction(
    transaction: PendingAuthorization,
  ): Promise<RegisteredClient> {
    if (
      !isAcceptableRedirectUri(transaction.redirectUri, this.redirectPolicy())
    ) {
      throw expiredTransaction();
    }
    const application = await this.registry.lookUpClient(transaction.clientId);
    if (
      !application ||
      !application.enabled ||
      application.platform !== APPLICATION_PLATFORM.NATIVE ||
      application.clientType !== APPLICATION_CLIENT_TYPE.PUBLIC ||
      !application.redirectUris.some((registered) =>
        matchesRegisteredRedirectUri(registered, transaction.redirectUri),
      )
    ) {
      throw expiredTransaction();
    }
    return application;
  }

  private redirectPolicy(): RedirectUriPolicy {
    return {
      nodeEnv: this.authEpoch.environment(),
      allowCustomScheme: this.authEpoch.nativeCustomSchemeAllowed(),
    };
  }

  private assertNativeEnabled(): void {
    if (this.authEpoch.nativeEnabled()) {
      return;
    }
    throw new AppException(
      ErrorCode.NATIVE_AUTH_DISABLED,
      'Native sign-in is disabled',
      HttpStatus.FORBIDDEN,
    );
  }
}

function expiredTransaction(): AppException {
  return new AppException(
    ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    'Native authorization transaction is expired or already ended',
    HttpStatus.NOT_FOUND,
  );
}
