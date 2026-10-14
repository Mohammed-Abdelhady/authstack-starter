import { existsSync } from 'node:fs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { CommandResult } from '../support/run-tool.js';
import { preparePackedWorkspace } from './packed-workspace.js';

describe('bounded packed cleanup', () => {
  it('waits up to three seconds for a task that cannot settle', async () => {
    vi.useFakeTimers();
    const workspace = preparePackedWorkspace();
    let settle: (result: CommandResult) => void = () => {};
    const unfinished = new Promise<CommandResult>((resolve) => {
      settle = resolve;
    });
    void workspace.runTask(() => unfinished);
    onTestFinished(async () => {
      settle({ ok: false, output: 'Stopped' });
      await workspace.cleanup();
      vi.useRealTimers();
    });
    const cleanup = workspace.cleanup();
    await vi.advanceTimersByTimeAsync(2999);
    expect(existsSync(workspace.workspace)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(existsSync(workspace.workspace)).toBe(false);
    await cleanup;
  });

  it('does not start another task or command after cleanup', async () => {
    const workspace = preparePackedWorkspace();
    onTestFinished(workspace.cleanup);
    await workspace.cleanup();
    let started = false;
    const result = await workspace.runTask(async () => {
      started = true;
      return { ok: true, output: '' };
    });
    const command = await workspace.runCommand(process.execPath, ['-e', 'process.exit(0);']);
    expect({ started, taskOk: result.ok, commandOk: command.ok }).toEqual({
      started: false,
      taskOk: false,
      commandOk: false,
    });
  });
});
