import {
  digestParts,
  safeEqual,
} from '../../native/factors/utils/native-passkey-assertion';
import {
  NATIVE_REGISTRATION_DIGEST_LABEL,
  PASSKEY_MAX_FIELD_LENGTH,
} from '../constants/passkeys.constants';
import type {
  ExpectedChallenge,
  PasskeyCredentialJson,
} from '../services/webauthn.adapter';

/** Who a native registration challenge was handed to. */
export interface ChallengeBinding {
  sessionId: string;
  userId: string;
  rpId: string;
}

/**
 * The stored form of a challenge. It names the session, the account and the
 * relying party, so a challenge copied into another session never matches.
 */
export function registrationDigest(
  binding: ChallengeBinding,
  challenge: string,
): string {
  return digestParts([
    NATIVE_REGISTRATION_DIGEST_LABEL,
    binding.sessionId,
    binding.userId,
    binding.rpId,
    challenge,
  ]);
}

/** The library's challenge check, against the stored digest only. */
export function matchesDigest(
  binding: ChallengeBinding,
  expected: string,
): ExpectedChallenge {
  return (challenge) =>
    safeEqual(registrationDigest(binding, challenge), expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PASSKEY_MAX_FIELD_LENGTH
  );
}

/**
 * The challenge the client data says the authenticator signed, or null when
 * the client data is missing or unreadable. The library checks the same
 * field against the digest afterwards; this read only finds the stored row.
 */
export function signedChallengeOf(
  credential: PasskeyCredentialJson,
): string | null {
  const { response } = credential;
  if (!isRecord(response) || !boundedText(response.clientDataJSON)) {
    return null;
  }
  let clientData: unknown;
  try {
    clientData = JSON.parse(
      Buffer.from(response.clientDataJSON, 'base64url').toString('utf8'),
    );
  } catch {
    return null;
  }
  if (!isRecord(clientData) || !boundedText(clientData.challenge)) {
    return null;
  }
  return clientData.challenge;
}
