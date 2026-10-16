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

describe('native user verification evidence', () => {
  const ACCOUNT = {
    userId: 'account-id',
    userVersion: 2,
    clientVersion: 3,
    grantVersion: null,
    authenticationMethods: ['hwk'],
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    firstFactor: 'passkey' as const,
  };

  // Catches the persistence filter losing verified or unverified passkey evidence.
  it.each([true, false])('preserves userVerified=%s', (userVerified) => {
    expect(
      nativeAttemptDetails({
        ...BASE,
        verifiedAccount: { ...ACCOUNT, userVerified },
      }),
    ).toEqual({
      verifiedAccount: {
        userId: 'account-id',
        userVersion: 2,
        clientVersion: 3,
        grantVersion: null,
        authenticationMethods: ['hwk'],
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        firstFactor: 'passkey',
        userVerified,
      },
      nonceDigest: null,
      email: null,
      codeReply: null,
    });
  });

  // Catches legacy attempts being given verification evidence they never recorded.
  it('omits userVerified when the stored attempt has no evidence', () => {
    expect(
      nativeAttemptDetails({ ...BASE, verifiedAccount: ACCOUNT }),
    ).toStrictEqual({
      verifiedAccount: {
        userId: 'account-id',
        userVersion: 2,
        clientVersion: 3,
        grantVersion: null,
        authenticationMethods: ['hwk'],
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        firstFactor: 'passkey',
      },
      nonceDigest: null,
      email: null,
      codeReply: null,
    });
  });
});
