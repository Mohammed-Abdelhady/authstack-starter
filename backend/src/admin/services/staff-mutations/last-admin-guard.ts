import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationPolicyReader } from '../../../auth/contracts/application-policy';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import {
  AdminRosterStore,
  type AdminSignInRule,
} from '../../stores/admin-roster.store';

/**
 * One administrator who can sign in must always remain. Every change that
 * could take an administrator's way in away takes the roster lock first and
 * asks here, inside its unit of work, before it writes.
 */
@Injectable()
export class LastAdminGuard {
  constructor(
    private readonly roster: AdminRosterStore,
    private readonly policies: ApplicationPolicyReader,
    private readonly config: ConfigService,
  ) {}

  /** Serialises administrator changes until the unit of work ends. */
  lock(unitOfWork: UnitOfWork): Promise<void> {
    return this.roster.lock(unitOfWork);
  }

  /**
   * @throws AppException CONFLICT when no administrator outside `targets`
   * could still sign in
   */
  async assertOthersCanSignIn(
    unitOfWork: UnitOfWork,
    targets: readonly string[],
  ): Promise<void> {
    await this.roster.lock(unitOfWork);
    const rule = await this.ruleFor(unitOfWork, targets);
    if ((await this.roster.countAdminsWhoCanSignIn(unitOfWork, rule)) > 0) {
      return;
    }
    throw new AppException(
      ErrorCode.CONFLICT,
      'At least one administrator who can sign in must remain',
      HttpStatus.CONFLICT,
    );
  }

  /** Staff sign in to the admin application when it is configured, otherwise to the web one. */
  private async ruleFor(
    unitOfWork: UnitOfWork,
    excluding: readonly string[],
  ): Promise<AdminSignInRule> {
    const clientId = this.config.get<string>('cors.adminUrl')
      ? ADMIN_CLIENT_ID
      : WEB_CLIENT_ID;
    const policy = await this.policies.requireEnabled(unitOfWork, clientId);
    const relyingParty =
      policy.requirePasskey === true ? policy.passkeyRelyingParty : null;
    return {
      excluding,
      passkeyRelyingParty: relyingParty
        ? {
            rpId: relyingParty.rpId,
            includesUnmarked:
              relyingParty.rpId === this.config.get<string>('passkeys.rpId'),
          }
        : null,
    };
  }
}
