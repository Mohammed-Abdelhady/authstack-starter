import { nativeCompletionDetails } from './native-completion-details';
import type {
  NativeAttemptDetails,
  VerifiedNativeAccount,
} from '../types/native-attempt';

const PRINCIPAL: VerifiedNativeAccount = {
  userId: 'account-id',
  userVersion: 2,
  clientVersion: 3,
  grantVersion: 4,
  authenticationMethods: ['pwd'],
  firstFactor: 'password',
  verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const DETAILS: NativeAttemptDetails = {
  policyHash: 'policy-hash',
  verifiedAccount: PRINCIPAL,
  nonceDigest: 'nonce-digest',
  email: { address: 'person@example.com', generation: 2, requestedAt: null },
  codeReply: null,
  secondFactors: ['totp', 'recoveryCode', 'passkey'],
  activationCompleted: true,
  passkeyChallengeHash: 'challenge-hash',
  passkeyPurpose: 'secondFactor',
  emailTokenHash: null,
  emailCodeGenerationHash: null,
};

describe('native last factor completion details', () => {
  // Catches TOTP completion inventing verification or dropping attempt authority fields.
  it('appends TOTP evidence and clears second factor state for a legacy attempt', () => {
    expect(
      nativeCompletionDetails(DETAILS, PRINCIPAL, {
        method: 'otp',
        userVerified: false,
      }),
    ).toEqual({
      policyHash: 'policy-hash',
      verifiedAccount: {
        userId: 'account-id',
        userVersion: 2,
        clientVersion: 3,
        grantVersion: 4,
        authenticationMethods: ['pwd', 'otp'],
        firstFactor: 'password',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        userVerified: false,
      },
      nonceDigest: 'nonce-digest',
      email: {
        address: 'person@example.com',
        generation: 2,
        requestedAt: null,
      },
      codeReply: null,
      secondFactors: undefined,
      activationCompleted: true,
      passkeyChallengeHash: null,
      passkeyPurpose: null,
      emailTokenHash: null,
      emailCodeGenerationHash: null,
    });
  });

  // Catches a verified passkey answer losing its verification evidence before issuance.
  it('appends passkey evidence and keeps the rest of the attempt', () => {
    expect(
      nativeCompletionDetails(
        DETAILS,
        { ...PRINCIPAL, userVerified: false },
        {
          method: 'hwk',
          userVerified: true,
        },
      ),
    ).toEqual({
      policyHash: 'policy-hash',
      verifiedAccount: {
        userId: 'account-id',
        userVersion: 2,
        clientVersion: 3,
        grantVersion: 4,
        authenticationMethods: ['pwd', 'hwk'],
        firstFactor: 'password',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        userVerified: true,
      },
      nonceDigest: 'nonce-digest',
      email: {
        address: 'person@example.com',
        generation: 2,
        requestedAt: null,
      },
      codeReply: null,
      secondFactors: undefined,
      activationCompleted: true,
      passkeyChallengeHash: null,
      passkeyPurpose: null,
      emailTokenHash: null,
      emailCodeGenerationHash: null,
    });
  });
});
