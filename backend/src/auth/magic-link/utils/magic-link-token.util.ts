import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { MAGIC_LINK_TOKEN_BYTES } from '../constants/magic-link.constants';

/** A fresh token for one link. Mailed once, never stored. */
export function createMagicLinkToken(): string {
  return randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
}

/** Hex sha256 of a token, which is what the pending record holds. */
export function hashMagicLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** True when two hex hashes are the same, compared in constant time. */
export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * Name for an account created by a magic link. There is no registration form
 * behind this sign-in, so the local part of the address stands in until the
 * account holder edits their profile.
 *
 * @param email - Address the link was mailed to
 * @returns Local part, or 'user' when it holds nothing usable
 */
export function deriveNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'user';
}
