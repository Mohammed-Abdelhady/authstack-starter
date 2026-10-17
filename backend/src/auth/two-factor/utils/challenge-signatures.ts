import { createHash, timingSafeEqual } from 'crypto';
import type { FirstFactor } from '../../services/sessions/first-factor';

export function hashNonce(nonce: string, firstFactor: FirstFactor): string {
  return createHash('sha256').update(`${nonce}.${firstFactor}`).digest('hex');
}

export function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
