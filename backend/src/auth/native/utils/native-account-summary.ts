import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { nativeDisplayName } from '../../../common/utils/native-display-name';
import { isNativeEmail } from '../../../common/utils/native-email';
import type { StoredAccount } from '../../../user/stores/stored-account';

export function nativeAccountSummary(
  account: Pick<StoredAccount, 'id' | 'email' | 'name'>,
) {
  if (!isNativeEmail(account.email)) {
    throw new AppException(
      ErrorCode.INTERNAL_ERROR,
      'Stored account email is invalid for native sign-in',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return {
    id: account.id,
    email: account.email,
    name: nativeDisplayName(account.name, account.email),
  };
}
