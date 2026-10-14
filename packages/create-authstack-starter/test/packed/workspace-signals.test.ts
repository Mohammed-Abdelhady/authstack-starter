import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startVitestWorkspaceFixture, startWorkspaceFixture } from './workspace-fixture.js';

describe('packed workspace signal cleanup', () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const mode of ['running', 'exited', 'escaped'] as const) {
      it(`first ${signal} removes the workspace and exits by signal with ${mode} pipes`, async () => {
        const { child, closed, workspace, descendantEnded } = await startWorkspaceFixture(mode);
        child.kill(signal);
        await closed;
        expect(existsSync(workspace)).toBe(false);
        expect({ code: child.exitCode, signal: child.signalCode }).toEqual({ code: null, signal });
        if (mode !== 'escaped') expect(await descendantEnded).toBe('eof');
      });
    }
  }

  it('removes the workspace before real forks pool forced cancellation kills its worker', async () => {
    const { child, closed, workspace, cancelling } = await startVitestWorkspaceFixture();
    child.kill('SIGINT');
    await cancelling;
    child.kill('SIGINT');
    await closed;
    expect(existsSync(workspace)).toBe(false);
  });
});
