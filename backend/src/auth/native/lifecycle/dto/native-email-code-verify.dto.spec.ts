import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { createValidationPipe } from '../../../../common/pipes/validation-pipe.factory';
import { NativeEmailCodeVerifyDto } from './native-email-code-verify.dto';

function validate(body: unknown): Promise<unknown> {
  return createValidationPipe().transform(body, {
    type: 'body',
    metatype: NativeEmailCodeVerifyDto,
  });
}

describe('native email code verify body', () => {
  it('accepts six Western digits, a leading zero included', async () => {
    await expect(validate({ code: '012345' })).resolves.toEqual(
      expect.objectContaining({ code: '012345' }),
    );
  });

  it.each([
    ['five digits', { code: '12345' }],
    ['seven digits', { code: '1234567' }],
    ['a letter', { code: '12a456' }],
    ['Arabic-Indic digits', { code: '٠١٢٣٤٥' }],
    ['an empty code', { code: '' }],
    ['no code', {}],
    ['a number', { code: 123456 }],
    ['an extra field', { code: '123456', email: 'someone@example.test' }],
  ])('refuses %s before any guess is counted', async (_case, body) => {
    const refused = await validate(body).then(
      () => null,
      (error: unknown) => error,
    );
    if (!(refused instanceof AppException)) {
      throw new Error('Expected the pipe to refuse the body');
    }
    expect({ code: refused.code, status: refused.getStatus() }).toEqual({
      code: ErrorCode.VALIDATION_ERROR,
      status: HttpStatus.BAD_REQUEST,
    });
  });
});
