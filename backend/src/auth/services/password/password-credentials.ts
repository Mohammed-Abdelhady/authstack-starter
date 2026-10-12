import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { HashService } from '../../../common/services/hash.service';
import { StoredAccount } from '../../../user/stores/stored-account';
import { PasswordSignInStore } from '../../stores/password-sign-in.store';

/** Verify a password and return the active account without its stored hash. */
export async function verifyPasswordCredentials(
  accounts: PasswordSignInStore,
  hashService: HashService,
  input: { email: string; password: string },
): Promise<StoredAccount> {
  const candidate = await accounts.findForPasswordCheck(input.email);

  if (!candidate?.passwordHash) {
    await hashService.spendComparison(input.password);
    throw invalidCredentials();
  }

  if (!(await hashService.compare(input.password, candidate.passwordHash))) {
    throw invalidCredentials();
  }

  return candidate.account;
}

function invalidCredentials(): AppException {
  return new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password',
    HttpStatus.UNAUTHORIZED,
  );
}
