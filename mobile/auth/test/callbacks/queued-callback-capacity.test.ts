import { describe, expect, it } from 'vitest';
import { queueRestoringAddress } from '../../src/sign-in/sign-in-utils';
import type { AuthTransaction } from '../../src/types/record';
import { CONFIG } from '../support/support';

const SAVED_TRANSACTION: AuthTransaction = {
  verifier: 'verifier',
  state: 'saved-state-123456789012345678901234',
  returnAddress: CONFIG.redirectUri,
  createdAt: 100,
  expiresAt: 200,
  operationId: 'operation-1',
};

describe('restoring callback capacity', () => {
  it('keeps the saved-state callback and stays at sixteen entries', () => {
    const saved = callback('saved-code', SAVED_TRANSACTION.state);
    const queue = [saved, callback('wrong-0', 'wrong-state-0')];
    for (let index = 1; index < 15; index += 1)
      queue.push(callback(`wrong-${index}`, `wrong-state-${index}`));

    const incoming = callback('wrong-new', 'wrong-state-new');
    queueRestoringAddress(queue, incoming, SAVED_TRANSACTION);

    expect(queue).toHaveLength(16);
    expect(queue[0]).toBe(saved);
    expect(queue).toContain(saved);
    expect(queue.at(-1)).toBe(incoming);
  });

  it('evicts the oldest callback while the saved transaction is not known', () => {
    const first = callback('unknown-0', 'state-0');
    const queue = [first];
    for (let index = 1; index < 16; index += 1)
      queue.push(callback(`unknown-${index}`, `state-${index}`));
    const incoming = callback('unknown-new', 'state-new');

    queueRestoringAddress(queue, incoming, undefined);

    expect(queue).toHaveLength(16);
    expect(queue[0]).toBe(callback('unknown-1', 'state-1'));
    expect(queue.at(-1)).toBe(incoming);
  });
});

function callback(code: string, state: string): string {
  return `${CONFIG.redirectUri}?code=${code}&state=${state}`;
}
