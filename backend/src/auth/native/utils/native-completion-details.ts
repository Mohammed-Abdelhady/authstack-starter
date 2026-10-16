import type {
  NativeAttemptDetails,
  VerifiedNativeAccount,
} from '../types/native-attempt';

export function nativeCompletionDetails(
  details: NativeAttemptDetails,
  verifiedAccount: VerifiedNativeAccount,
  factor: { method: string; userVerified: boolean },
): NativeAttemptDetails {
  return {
    ...details,
    secondFactors: undefined,
    passkeyChallengeHash: null,
    passkeyPurpose: null,
    verifiedAccount: {
      ...verifiedAccount,
      authenticationMethods: [
        ...verifiedAccount.authenticationMethods,
        factor.method,
      ],
      userVerified:
        verifiedAccount.userVerified === true || factor.userVerified,
    },
  };
}
