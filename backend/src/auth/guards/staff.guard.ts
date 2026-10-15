import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { ROLE_AUDIENCE } from '../../host/types/host-role.type';
import { AudiencePolicy } from '../../session/applications/audience-policy';
import { ApplicationRegistry } from '../../session/applications/application-registry';
import { ADMIN_CLIENT_ID } from '../../session/constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../session/constants/credential-purpose';
import { FIRST_FACTOR } from '../services/sessions/first-factor';
import type { RequestWithUser } from './auth.guard';

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly policy: AudiencePolicy,
    private readonly applications: ApplicationRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.policy.staffGuardEnabled()) return true;
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const session = request.session;
    if (
      !session ||
      session.clientId !== ADMIN_CLIENT_ID ||
      session.credentialPurpose !== CREDENTIAL_PURPOSE.BROWSER_SESSION ||
      session.user?.audience !== ROLE_AUDIENCE.STAFF
    ) {
      throw this.refused();
    }
    const application = await this.applications.requireEnabled(ADMIN_CLIENT_ID);
    if (
      application.requirePasskey &&
      (!session.userVerified ||
        !session.authenticationMethods.includes(FIRST_FACTOR.PASSKEY))
    ) {
      throw this.refused();
    }
    return true;
  }

  private refused(): AppException {
    return new AppException(
      ErrorCode.FORBIDDEN,
      'An admin browser session for a staff account is required',
      HttpStatus.FORBIDDEN,
    );
  }
}
