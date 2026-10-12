import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import { REVOKED_REASON } from '../constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import { asAuthorityUnavailable } from '../utils/authority/authority-unavailable';
import {
  APPLICATION_SWITCH,
  ApplicationAccessStore,
  ApplicationSwitch,
} from './application-access.store';

/** A grant created already blocked starts past the version no session carries. */
const BLOCKED_GRANT_FIRST_VERSION = 1;

/**
 * Blocks a person from an application, and switches an application off and on.
 * Sessions carry the version of their application and of their grant, so
 * advancing either one ends every session that depends on it. Each change and
 * its security event are one unit of work.
 */
@Injectable()
export class ApplicationAccess {
  constructor(
    private readonly unitOfWork: UnitOfWorkRunner,
    private readonly store: ApplicationAccessStore,
    private readonly authEpoch: AuthEpochService,
  ) {}

  /**
   * Whether the person holds an allowed grant for the client, on a plain read.
   * Good for telling someone what they agreed to before. Not an authority read.
   */
  async isGrantAllowed(userId: string, clientId: string): Promise<boolean> {
    const grant = await this.store.readGrant(userId, clientId);
    return grant?.allowed === true;
  }

  async blockGrant(userId: string, clientId: string): Promise<void> {
    await this.run(async (unitOfWork) => {
      const grant = await this.store.takeGrantForChange(
        unitOfWork,
        userId,
        clientId,
      );
      if (grant) {
        await this.store.blockGrant(unitOfWork, grant.id);
      } else {
        await this.store.createBlockedGrant(unitOfWork, {
          userId,
          clientId,
          sessionVersion: BLOCKED_GRANT_FIRST_VERSION,
        });
      }
      await this.store.appendSecurityEvent(unitOfWork, {
        targetUserId: userId,
        clientId,
        action: SECURITY_EVENT_ACTION.GRANT_BLOCKED,
      });
    });
  }

  async disableApplication(clientId: string): Promise<void> {
    await this.run(async (unitOfWork) => {
      requireRegistered(
        await this.store.disableApplication(
          unitOfWork,
          this.authEpoch.environment(),
          clientId,
        ),
      );
      await this.store.appendSecurityEvent(unitOfWork, {
        clientId,
        action: SECURITY_EVENT_ACTION.APPLICATION_DISABLED,
        reasonCode: REVOKED_REASON.APPLICATION_DISABLED,
      });
    });
  }

  async enableApplication(clientId: string): Promise<void> {
    await this.run(async (unitOfWork) => {
      requireRegistered(
        await this.store.enableApplication(
          unitOfWork,
          this.authEpoch.environment(),
          clientId,
        ),
      );
      await this.store.appendSecurityEvent(unitOfWork, {
        clientId,
        action: SECURITY_EVENT_ACTION.APPLICATION_ENABLED,
      });
    });
  }

  private async run(
    work: (unitOfWork: UnitOfWork) => Promise<void>,
  ): Promise<void> {
    try {
      await this.unitOfWork.run(work);
    } catch (error) {
      asAuthorityUnavailable(error);
    }
  }
}

function requireRegistered(outcome: ApplicationSwitch): void {
  if (outcome !== APPLICATION_SWITCH.SWITCHED) {
    throw new AppException(
      ErrorCode.APPLICATION_NOT_FOUND,
      'Application is not registered',
      HttpStatus.NOT_FOUND,
    );
  }
}
