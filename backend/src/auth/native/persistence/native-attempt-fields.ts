import { NativeAttemptDetails } from '../types/native-attempt';

/** Persist only declared safe fields even if a runtime caller supplies extra keys. */
export function nativeAttemptDetails(
  details: NativeAttemptDetails,
): NativeAttemptDetails {
  const account = details.verifiedAccount;
  const email = details.email;
  const reply = details.codeReply;
  return {
    verifiedAccount: account
      ? {
          userId: account.userId,
          userVersion: account.userVersion,
          clientVersion: account.clientVersion,
          grantVersion: account.grantVersion,
          authenticationMethods: [...account.authenticationMethods],
          verifiedAt: account.verifiedAt,
        }
      : null,
    nonceDigest: details.nonceDigest,
    email: email
      ? {
          address: email.address,
          generation: email.generation,
          requestedAt: email.requestedAt,
        }
      : null,
    codeReply: reply
      ? {
          ciphertext: reply.ciphertext,
          iv: reply.iv,
          tag: reply.tag,
          expiresAt: reply.expiresAt,
        }
      : null,
  };
}

export function assertNativeAttemptSecretHash(secretHash: string): void {
  if (!/^[0-9a-f]{64}$/.test(secretHash)) {
    throw new Error('Native attempt secret hash must be SHA-256 hex');
  }
}
