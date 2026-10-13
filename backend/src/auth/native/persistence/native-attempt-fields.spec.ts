import { nativeAttemptDetails } from './native-attempt-fields';
import type { NativeAttemptDetails } from '../types/native-attempt';

const BASE: NativeAttemptDetails = {
  verifiedAccount: null,
  nonceDigest: null,
  email: null,
  codeReply: null,
};

describe('native email code generation commitment', () => {
  it('preserves the digest without forwarding raw credentials', () => {
    const input = Object.assign(
      { ...BASE, emailCodeGenerationHash: 'a'.repeat(64) },
      { verificationCode: '123456', password: 'untrusted-password' },
    );
    expect(nativeAttemptDetails(input)).toEqual({
      ...BASE,
      emailCodeGenerationHash: 'a'.repeat(64),
    });
  });

  it('preserves a cleared commitment and omits an absent one', () => {
    expect(
      nativeAttemptDetails({ ...BASE, emailCodeGenerationHash: null }),
    ).toEqual({ ...BASE, emailCodeGenerationHash: null });
    expect(nativeAttemptDetails(BASE)).toEqual(BASE);
  });
});
