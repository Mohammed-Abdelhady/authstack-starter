import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { ApiError } from '../errors';
import { answering } from '../test-support';
import { deletionReceiptKey } from './account-deletion';

describe('account deletion receipts', () => {
  it('builds a server-shaped key with the supplied time and all 32 bytes', () => {
    const key = deletionReceiptKey(1234, new Uint8Array(32).fill(171));
    expect(key).toBe('r1.1234.abababababababababababababababababababababababababababababababab');
  });

  it('refuses short randomness and negative time', () => {
    expect(() => deletionReceiptKey(1234, new Uint8Array(31))).toThrow(RangeError);
    expect(() => deletionReceiptKey(-1, new Uint8Array(32))).toThrow(RangeError);
  });

  it('refuses an unrecognized receipt state', async () => {
    const transport = answering(200, { success: true, data: { state: 'deleted' } });
    const result = createApiClient(transport).accountDeletion.receipt('key');
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 200, code: 'UNKNOWN_ERROR' });
  });
});
