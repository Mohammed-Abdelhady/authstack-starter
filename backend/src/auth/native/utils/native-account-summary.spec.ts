import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { nativeAccountSummary } from './native-account-summary';

const SUFFIX = '@example.test';
const EMAIL_AT_LIMIT = `${'a'.repeat(255 - SUFFIX.length)}${SUFFIX}`;
const EMAIL_OVER_LIMIT = `${'a'.repeat(256 - SUFFIX.length)}${SUFFIX}`;

describe('native account summary', () => {
  it('preserves id and email while normalizing the display name', () => {
    const account = {
      id: 'account-1',
      email: EMAIL_AT_LIMIT,
      name: ' E\u0301mile ',
    };

    expect(nativeAccountSummary(account)).toEqual({
      id: 'account-1',
      email: EMAIL_AT_LIMIT,
      name: 'Émile',
    });
    expect(account).toEqual({
      id: 'account-1',
      email: EMAIL_AT_LIMIT,
      name: ' E\u0301mile ',
    });
  });

  it('bounds the display name through the existing native formatter', () => {
    expect(
      nativeAccountSummary({
        id: 'account-2',
        email: 'account@example.test',
        name: 'n'.repeat(101),
      }),
    ).toEqual({
      id: 'account-2',
      email: 'account@example.test',
      name: 'n'.repeat(100),
    });
  });

  it.each([
    ['overlong', EMAIL_OVER_LIMIT],
    ['malformed', 'missing-domain'],
  ])('rejects %s stored email without exposing it', (_, email) => {
    let caught: unknown;
    try {
      nativeAccountSummary({ id: 'account-3', email, name: 'Account' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppException);
    if (!(caught instanceof AppException)) throw new Error('error missing');
    expect(caught.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(caught.getStatus()).toBe(500);
    expect(caught.message).not.toContain(email);
  });

  it('rejects a runtime account whose stored email is missing', () => {
    let caught: unknown;
    try {
      Reflect.apply(nativeAccountSummary, undefined, [
        { id: 'account-4', name: 'Account' },
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppException);
    if (!(caught instanceof AppException)) throw new Error('error missing');
    expect(caught.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(caught.getStatus()).toBe(500);
  });
});
