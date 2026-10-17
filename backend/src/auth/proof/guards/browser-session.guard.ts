import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { CREDENTIAL_PURPOSE } from '../../../session/constants/credential-purpose';
import type { RequestWithUser } from '../../guards/auth.guard';

@Injectable()
export class BrowserSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (
      request.session?.credentialPurpose !== CREDENTIAL_PURPOSE.BROWSER_SESSION
    ) {
      throw new AppException(
        ErrorCode.SESSION_REQUIRED,
        'A full browser session is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
