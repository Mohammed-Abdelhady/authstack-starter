import { HttpStatus, Injectable } from '@nestjs/common';
import type { NativeAttemptView } from '@app/sdk';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { nativeDisplayName } from '../../../common/utils/native-display-name';
import { ApplicationRegistry } from '../../../session/applications/application-registry';
import { ApplicationAccessStore } from '../../../session/applications/application-access.store';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import type { NativeAttempt } from '../types/native-attempt';
import { NativeMethodsService } from './native-methods.service';
import { nativeFirstFactors } from '../utils/native-first-factors';

@Injectable()
export class NativeAttemptViewService {
  constructor(
    private readonly methods: NativeMethodsService,
    private readonly registry: ApplicationRegistry,
    private readonly grants: ApplicationAccessStore,
    private readonly accounts: AccountProfileStore,
  ) {}

  async view(attempt: NativeAttempt): Promise<NativeAttemptView> {
    const base = {
      attemptId: attempt.attemptId,
      expiresAt: attempt.expiresAt.toISOString(),
    };
    switch (attempt.phase) {
      case 'firstFactorRequired': {
        const methods = await this.methods.forClient(attempt.clientId);
        return {
          ...base,
          stage: 'firstFactorRequired',
          factors: nativeFirstFactors(methods),
        };
      }
      case 'emailLinkSent':
        return {
          ...base,
          stage: 'emailLinkSent',
          email: attempt.details.email?.address ?? '',
        };
      case 'registrationCodeRequired':
        return {
          ...base,
          stage: 'registrationCodeRequired',
          email: attempt.details.email?.address ?? '',
          activationCompleted: attempt.details.activationCompleted,
        };
      case 'recoveryCodeRequired':
        return {
          ...base,
          stage: 'recoveryCodeRequired',
          email: attempt.details.email?.address ?? '',
        };
      case 'secondFactorRequired': {
        const secondFactorView = {
          ...base,
          stage: 'secondFactorRequired' as const,
          factors: attempt.details.secondFactors ?? [],
          activationCompleted: attempt.details.activationCompleted,
        };
        return secondFactorView;
      }
      case 'consentRequired': {
        const verified = attempt.details.verifiedAccount;
        if (!verified) throw wrongStage();
        const account = await this.accounts.findProfile(verified.userId);
        const client = await this.registry.lookUpClient(attempt.clientId);
        if (!account || !client) throw wrongStage();
        const grant = await this.grants.readGrant(account.id, attempt.clientId);
        return {
          ...base,
          stage: 'consentRequired',
          account: {
            id: account.id,
            email: account.email,
            name: nativeDisplayName(account.name, account.email),
          },
          application: {
            clientId: client.clientId,
            displayName: client.displayName,
            scopes: attempt.requestedScopes,
            alreadyGranted: grant?.allowed === true,
          },
          activationCompleted: attempt.details.activationCompleted,
        };
      }
      case 'codeReady':
        throw wrongStage();
      case 'recoveryComplete':
        return { ...base, stage: 'recoveryComplete', passwordUpdated: true };
      default:
        return { ...base, stage: 'denied', reason: 'cancelled' };
    }
  }
}

function wrongStage(): AppException {
  return new AppException(
    ErrorCode.CONFLICT,
    'Native attempt state changed',
    HttpStatus.CONFLICT,
  );
}
