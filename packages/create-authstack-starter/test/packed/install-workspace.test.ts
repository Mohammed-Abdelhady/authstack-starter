import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { installProject } from '../support/combination-helpers.js';
import { preparePackedWorkspace } from './packed-workspace.js';
import { startWorkspaceProbe } from './workspace-probe.js';
import { killFixtureProcesses } from './workspace-fixture.js';
import { createDescendantPipe, DESCENDANT_PIPE_ENV } from '../support/descendant-pipe.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/workspace-command.ts', import.meta.url));

describe('packed installation lifetime', () => {
  it('cancels the install and waits for completion before deleting its workspace', async () => {
    const workspace = preparePackedWorkspace();
    const death = createDescendantPipe(workspace.workspace);
    const previousPath = process.env.PATH;
    const pids: number[] = [];
    const resources: { probe?: ReturnType<typeof startWorkspaceProbe> } = {};
    onTestFinished(async () => {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      resources.probe?.close();
      killFixtureProcesses(pids);
      await resources.probe?.result;
      death.close();
      await workspace.cleanup();
      rmSync(workspace.workspace, { recursive: true, force: true });
    });
    writeFileSync(join(workspace.workspace, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(
      join(workspace.pnpmDirectory, 'pnpm'),
      `#!${process.execPath}\nrequire('node:child_process').spawn(process.execPath,
        ['--experimental-strip-types', ${JSON.stringify(FIXTURE)},
          require('node:path').join(process.cwd(), 'command-ready.json'), 'running'],
        { stdio: 'inherit', env: { ...process.env,
          ${JSON.stringify(DESCENDANT_PIPE_ENV)}: ${JSON.stringify(death.path)} } });\n`,
    );
    process.env.PATH = [workspace.pnpmDirectory, previousPath].filter(Boolean).join(delimiter);
    let presentAtCompletion = false;
    const probe = startWorkspaceProbe(workspace, 'running', () =>
      workspace.runTask(async (signal) => {
        const result = await installProject(
          workspace.workspace,
          join(workspace.workspace, 'store'),
          signal,
        );
        presentAtCompletion = existsSync(workspace.workspace);
        return result;
      }),
    );
    resources.probe = probe;
    const ready = await probe.ready;
    pids.push(ready.pid, ready.descendantPid);
    await death.ready;
    await workspace.cleanup();
    const result = await probe.result;
    expect({ ok: result.ok, reason: result.output.split('\n')[1] }).toEqual({
      ok: false,
      reason: 'Aborted',
    });
    expect(presentAtCompletion).toBe(true);
    expect(existsSync(workspace.workspace)).toBe(false);
    expect(await death.ended).toBe('eof');
  });
});
