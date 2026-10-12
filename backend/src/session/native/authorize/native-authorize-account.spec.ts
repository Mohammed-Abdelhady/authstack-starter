import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { createValidationPipe } from '../../../common/pipes/validation-pipe.factory';
import { NativeAuthorizeActionDto } from './dto/native-authorize.dto';
import { assertDisplayedAccount } from '../oauth/native-request';

const SESSION_USER_ID = '65f1c0a4e4b0a1b2c3d4e5f6';
const TRANSACTION_ID = '65bd2588-08ef-4489-9b07-543ca8124319';

async function consent(expectedUserId?: unknown): Promise<void> {
  const body: unknown = await createValidationPipe().transform(
    { transactionId: TRANSACTION_ID, expectedUserId },
    { type: 'body', metatype: NativeAuthorizeActionDto },
  );
  if (!(body instanceof NativeAuthorizeActionDto)) {
    throw new Error('The validation pipe did not return the consent DTO');
  }
  assertDisplayedAccount(SESSION_USER_ID, body.expectedUserId);
}

describe('native consent account validation handoff', () => {
  it('accepts the signed-in account', async () => {
    await expect(consent(SESSION_USER_ID)).resolves.toBeUndefined();
  });

  it('refuses an action that names no account before comparison', async () => {
    const body = createValidationPipe().transform(
      { transactionId: TRANSACTION_ID },
      { type: 'body', metatype: NativeAuthorizeActionDto },
    );

    await expect(body).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });

  it.each(['another-user', ''])(
    'refuses a different string account %p',
    async (id) => {
      await expect(consent(id)).rejects.toMatchObject({
        code: ErrorCode.NATIVE_AUTHORIZE_ACCOUNT_MISMATCH,
        status: HttpStatus.CONFLICT,
      });
    },
  );

  it.each([7, ['user'], { id: 'user' }, null])(
    'refuses non-string account %p before comparison',
    async (id) => {
      await expect(consent(id)).rejects.toBeInstanceOf(AppException);
      await expect(consent(id)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    },
  );
});
