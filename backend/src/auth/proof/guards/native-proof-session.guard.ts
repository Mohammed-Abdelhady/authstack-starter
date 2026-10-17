// feature:passkeys:start
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { CREDENTIAL_PURPOSE } from '../../../session/constants/credential-purpose';
import type { RequestWithUser } from '../../guards/auth.guard';

@Injectable()
export class NativeProofSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (
      request.session?.credentialPurpose !== CREDENTIAL_PURPOSE.NATIVE_ACCESS
    ) {
      throw new AppException(
        ErrorCode.SESSION_REQUIRED,
        'A native access session is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
// feature:passkeys:end
