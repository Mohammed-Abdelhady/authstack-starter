import { createHash, timingSafeEqual } from 'node:crypto';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/** Commit to the verifier the pending-code store actually wrote. */
export function hashPendingCodeGeneration(hashedCode: string): string {
  return createHash('sha256').update(hashedCode).digest('hex');
}

/** Compare a stored commitment without exposing how many bytes matched. */
export function matchesPendingCodeGeneration(
  expected: string | null | undefined,
  actual: string,
): boolean {
  if (
    expected === null ||
    expected === undefined ||
    !SHA256_HEX_PATTERN.test(expected) ||
    !SHA256_HEX_PATTERN.test(actual)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(actual, 'hex'),
  );
}
