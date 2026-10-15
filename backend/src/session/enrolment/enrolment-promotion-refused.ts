// feature:passkeys:start
import { HttpStatus } from '@nestjs/common';
import type { EnrolmentPromotionInput } from '../../auth/contracts/types/enrolment-promotion';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';

export class EnrolmentPromotionRefused extends AppException {
  constructor(
    readonly audience?: Pick<EnrolmentPromotionInput, 'userId' | 'clientId'>,
  ) {
    super(
      ErrorCode.PASSKEY_CHALLENGE_INVALID,
      'This passkey attempt is no longer valid. Start again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
// feature:passkeys:end
