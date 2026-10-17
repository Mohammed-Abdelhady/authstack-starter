import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startWorkspaceProbe } from './workspace-probe.js';
import { preparePackedWorkspace } from './packed-workspace.js';
import { killFixtureProcesses } from './workspace-fixture.js';
import { createDescendantPipe, DESCENDANT_PIPE_ENV } from '../support/descendant-pipe.js';

describe('packed workspace lifetime', () => {
  it('cleans up a running command before its caller can await completion', async () => {
    const counts = {
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGINT: process.listenerCount('SIGINT'),
    };
    const workspace = preparePackedWorkspace();
    const death = createDescendantPipe(workspace.workspace);
    const probe = startWorkspaceProbe(workspace, 'running', (file, args) =>
      workspace.runCommand(file, args, { env: { [DESCENDANT_PIPE_ENV]: death.path } }),
    );
    const resources: { pids: number[] } = { pids: [] };
    onTestFinished(async () => {
      probe.close();
      killFixtureProcesses(resources.pids);
      await probe.result;
      death.close();
      await workspace.cleanup();
      rmSync(workspace.workspace, { recursive: true, force: true });
    });
    const { pid, descendantPid } = await probe.ready;
    resources.pids.push(pid, descendantPid);
    await death.ready;
    expect(process.kill(pid, 0)).toBe(true);
    await workspace.cleanup();
    await workspace.cleanup();
    const result = await probe.result;
    expect({ ok: result.ok, reason: result.output.split('\n')[1] }).toEqual({
      ok: false,
      reason: 'Aborted',
    });
    expect(existsSync(workspace.workspace)).toBe(false);
    expect(await death.ended).toBe('eof');
    expect({
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGINT: process.listenerCount('SIGINT'),
    }).toEqual(counts);
  });

  it('releases normally and idempotently without removing other signal listeners', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cna-release-test-'));
    const otherListener = (): void => {};
    process.on('SIGTERM', otherListener);
    process.on('SIGINT', otherListener);
    const counts = {
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGINT: process.listenerCount('SIGINT'),
    };
    let release: (() => Promise<void>) | undefined;

    try {
      const { cleanup } = preparePackedWorkspace(root);
      release = cleanup;
      await cleanup();
      await cleanup();

      expect(readdirSync(root)).toEqual([]);
      expect({
        SIGTERM: process.listenerCount('SIGTERM'),
        SIGINT: process.listenerCount('SIGINT'),
      }).toEqual(counts);
    } finally {
      await release?.();
      process.off('SIGTERM', otherListener);
      process.off('SIGINT', otherListener);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
