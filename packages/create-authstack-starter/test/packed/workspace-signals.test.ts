import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startVitestWorkspaceFixture, startWorkspaceFixture } from './workspace-fixture.js';

const SIGNAL_EXIT_TIMEOUT_MS = 3000;
/** ps modes that list processes, so an escaped descendant is found and killed. */
const LISTING_PS_MODES: ReadonlySet<string> = new Set(['system', 'working']);
const SIGNAL_CASES = [
  ['running', 'system'],
  ['exited', 'system'],
  ['escaped', 'system'],
  ['escaped', 'working'],
  ['escaped', 'failing'],
  ['escaped', 'timeout'],
] as const;

async function waitForSignalExit(closed: Promise<string>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Signal fixture did not exit.')),
      SIGNAL_EXIT_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([closed, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

describe('packed workspace signal cleanup', () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const [mode, psMode] of SIGNAL_CASES) {
      it(`first ${signal} cleans up ${mode} pipes with ${psMode} ps`, async () => {
        const { child, closed, workspace, descendantEnded } = await startWorkspaceFixture(
          mode,
          psMode,
        );
        expect(child.kill(signal)).toBe(true);
        await waitForSignalExit(closed);
        expect(existsSync(workspace)).toBe(false);
        expect({ code: child.exitCode, signal: child.signalCode }).toEqual({ code: null, signal });
        if (mode !== 'escaped' || LISTING_PS_MODES.has(psMode))
          expect(await descendantEnded).toBe('eof');
      });
    }
  }

  it('removes the workspace before real forks pool forced cancellation kills its worker', async () => {
    const fixture = startVitestWorkspaceFixture();
    const { child, closed, cancelling } = fixture;
    const workspace = await fixture.ready;
    child.kill('SIGINT');
    await cancelling;
    child.kill('SIGINT');
    await closed;
    expect(existsSync(workspace)).toBe(false);
    await fixture.cleanup();
  });

  it('kills the nested Vitest group when it fails before reporting ready', async () => {
    const fixture = startVitestWorkspaceFixture('early-failure');
    if (fixture.death === undefined) throw new Error('Early failure death pipes are required.');
    await Promise.all([fixture.death.worker.ready, fixture.death.descendant.ready]);
    await expect(fixture.ready).rejects.toThrow('Vitest exited before handshake');
    await fixture.closed;
    await fixture.cleanup();
    expect(await fixture.death.worker.ended).toBe('eof');
    expect(await fixture.death.descendant.ended).toBe('eof');
  });
});
