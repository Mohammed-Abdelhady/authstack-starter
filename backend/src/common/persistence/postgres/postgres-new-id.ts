import { randomBytes } from 'node:crypto';

const VERSION_7 = 0x70;
const VARIANT_RFC = 0x80;

/**
 * A UUID version 7 made by the application, for the few ids a service needs
 * before its row is written. Every other id is the column default `uuidv7()`.
 * The time goes in so new rows land together in the index. Nothing reads it
 * back out: an id is opaque to everything above and inside the adapter.
 */
export function newPostgresId(now: Date): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now.getTime(), 0, 6);
  bytes[6] = VERSION_7 | (bytes[6] & 0x0f);
  bytes[8] = VARIANT_RFC | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
