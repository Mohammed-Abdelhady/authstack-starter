import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import { BrowserIssuanceStore } from '../../../session/issuance/browser-issuance.store';
import {
  ApplicationPolicyReader,
  requiredRelyingParties,
} from '../../contracts/application-policy';
import type { IssuancePolicy } from '../../contracts/types/application-policy';

/** An application that is gone or switched off lets nobody in, so it requires nothing. */
const ABSENT_APPLICATION = new Set<string>([
  ErrorCode.APPLICATION_DISABLED,
  ErrorCode.APPLICATION_NOT_FOUND,
]);

/**
 * The relying parties an account has to keep a passkey for: those of the
 * enabled applications that admit the account and let it in with a passkey
 * only. Another way in does not stand in for such a passkey.
 */
@Injectable()
export class RequiredPasskeyRelyingParties {
  constructor(
    private readonly policies: ApplicationPolicyReader,
    private readonly accounts: BrowserIssuanceStore,
    private readonly applications: BrowserApplications,
    private readonly epoch: AuthEpochService,
  ) {}

  /** Read in the unit of work that removes a passkey. */
  async forAccountIn(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<string[]> {
    const account = await this.accounts.findAccount(unitOfWork, userId);
    if (!account) return [];
    const policies: IssuancePolicy[] = [];
    for (const clientId of this.clientIds()) {
      const policy = await this.enabledPolicy(unitOfWork, clientId);
      if (policy) policies.push(policy);
    }
    return requiredRelyingParties(policies, account.accountAudience ?? null);
  }

  private clientIds(): string[] {
    const native = this.epoch.nativeEnabled()
      ? this.epoch.nativeApplications().map(({ clientId }) => clientId)
      : [];
    const admin = this.applications.isConfigured(ADMIN_CLIENT_ID)
      ? [ADMIN_CLIENT_ID]
      : [];
    return [WEB_CLIENT_ID, ...admin, ...native];
  }

  private async enabledPolicy(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuancePolicy | null> {
    try {
      return await this.policies.requireEnabled(unitOfWork, clientId);
    } catch (error) {
      if (error instanceof AppException && ABSENT_APPLICATION.has(error.code)) {
        return null;
      }
      throw error;
    }
  }
}
