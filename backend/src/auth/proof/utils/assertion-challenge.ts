// feature:passkeys:start
import { hashToken } from '../../../session/utils/hashing/token-hash';

export function assertionChallenge(response: Record<string, unknown>): {
  challenge: string;
  challengeHash: string;
} {
  const encoded = response.clientDataJSON;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('Invalid client data');
  }
  const data: unknown = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  if (
    typeof data !== 'object' ||
    data === null ||
    !('challenge' in data) ||
    typeof data.challenge !== 'string' ||
    !data.challenge
  ) {
    throw new Error('Missing challenge');
  }
  return {
    challenge: data.challenge,
    challengeHash: hashToken(data.challenge),
  };
}
// feature:passkeys:end
