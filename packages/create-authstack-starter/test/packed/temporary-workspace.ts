import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  killToolGroups,
  runTool,
  type CommandResult,
  type ToolOptions,
} from '../support/run-tool.js';

export const CANCELLED_COMMAND_WAIT_MS = 3000;

export function allocatePackedWorkspace(root = tmpdir()): {
  workspace: string;
  cleanup: () => Promise<void>;
  runTask: (task: (signal: AbortSignal) => Promise<CommandResult>) => Promise<CommandResult>;
  runCommand: (
    file: string,
    args: string[],
    options?: Omit<ToolOptions, 'signal'>,
  ) => Promise<CommandResult>;
} {
  const workspace = mkdtempSync(join(root, 'cna-e2e-'));
  const controller = new AbortController();
  const pending = new Set<Promise<CommandResult>>();
  let release: Promise<void> | undefined;
  let removed = false;
  const onTerm = (): void => {
    terminate('SIGTERM');
  };
  const onInt = (): void => {
    terminate('SIGINT');
  };
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);

  function unregister(): void {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
  }

  function remove(): void {
    try {
      if (removed) return;
      rmSync(workspace, { recursive: true, force: true });
      removed = true;
    } finally {
      unregister();
    }
  }

  function cleanup(): Promise<void> {
    if (release) return release;
    controller.abort();
    // Setup failures still release synchronously before propagating their error.
    if (pending.size === 0) {
      remove();
      release = Promise.resolve();
    } else {
      release = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, CANCELLED_COMMAND_WAIT_MS);
        void Promise.allSettled([...pending]).then(() => {
          clearTimeout(timer);
          resolve();
        });
      }).then(() => remove());
    }
    return release;
  }

  function terminate(signal: 'SIGTERM' | 'SIGINT'): void {
    try {
      // Abort would enter the normal ps-based tree walk before the folder is removed.
      killToolGroups(controller.signal);
    } finally {
      try {
        remove();
      } finally {
        unregister();
        process.kill(process.pid, signal);
      }
    }
  }

  function runTask(task: (signal: AbortSignal) => Promise<CommandResult>): Promise<CommandResult> {
    if (controller.signal.aborted) {
      return Promise.resolve({ ok: false, output: 'Workspace has been released', stdout: '' });
    }
    const command = Promise.resolve().then(() => task(controller.signal));
    pending.add(command);
    void command.then(
      () => pending.delete(command),
      () => pending.delete(command),
    );
    return command;
  }

  function runCommand(
    file: string,
    args: string[],
    options: Omit<ToolOptions, 'signal'> = {},
  ): Promise<CommandResult> {
    return runTask((signal) => runTool(file, args, { ...options, signal }));
  }

  return { workspace, cleanup, runCommand, runTask };
}
