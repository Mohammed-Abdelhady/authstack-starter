import { expect } from 'vitest';
import { readStoredValue } from '../../src/storage/envelope';
import { createAuthEngine } from './engine';
import { CONFIG, ScriptedTransport, testPorts } from './support';

interface WaitingOn {
  refreshToken: string;
  attempts: number;
  /** A device-bound token keeps its key thumbprint, so the retry can prove the key again. */
  bound: boolean;
}

/**
 * After a revoke the server did not confirm, the slot holds that token only as
 * a pending revocation: no session, and an app started on it cannot sign in or
 * refresh with the token.
 */
export async function expectOnlyPendingRevocation(
  ports: ReturnType<typeof testPorts>,
  waiting: WaitingOn,
): Promise<void> {
  const stored = ports.credentials.value;
  const read = readStoredValue(stored ?? '');
  expect(read).toMatchObject({
    kind: 'read',
    session: undefined,
    pending: [{ refreshToken: waiting.refreshToken, attempts: waiting.attempts }],
  });
  const entry = read.kind === 'read' ? read.pending[0] : undefined;
  expect(entry?.proofKeyThumbprint !== undefined).toBe(waiting.bound);

  const transport = new ScriptedTransport();
  const restartedPorts = testPorts(transport);
  restartedPorts.credentials.value = stored;
  restartedPorts.install = ports.install;
  restartedPorts.clock.wall = ports.clock.wall;
  const restarted = createAuthEngine(CONFIG, restartedPorts);
  await expect(restarted.restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });
  await expect(restarted.refresh()).resolves.toEqual({ kind: 'notSignedIn' });
  expect(transport.sent).toEqual([]);
  expect(restartedPorts.credentials.value).toBe(stored);
}
