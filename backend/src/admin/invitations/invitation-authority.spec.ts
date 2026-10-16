import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { invitationNeedsAct } from './invitation-authority';

// Failure: a non-administrator uses the administrator invitation exception, including revocation.
describe('administrator invitation authority', () => {
  it.each([false, true])(
    'refuses a non-administrator even when revoking=%s',
    (revoking) => {
      let refusal: unknown;
      try {
        invitationNeedsAct('support', 'admin', revoking);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(AppException);
      expect(refusal).toMatchObject({ code: ErrorCode.FORBIDDEN });
    },
  );

  // Failure: an administrator invitation is issued or resent without requiring an act.
  it('requires an administrator act for issue and resend', () => {
    expect(invitationNeedsAct('admin', 'admin')).toBe(true);
    expect(invitationNeedsAct('admin', 'admin', true)).toBe(false);
  });

  // Failure: ordinary assignments bypass the existing creation hierarchy through an administrator exception.
  it('leaves ordinary roles on the normal creation path', () => {
    expect(invitationNeedsAct('admin', 'support')).toBe(false);
    expect(invitationNeedsAct('support', 'user')).toBe(false);
  });
});
