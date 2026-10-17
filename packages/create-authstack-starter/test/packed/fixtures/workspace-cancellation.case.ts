import { chmodSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { it } from 'vitest';
import { preparePackedWorkspace } from '../packed-workspace.js';
import { startWorkspaceProbe } from '../workspace-probe.js';

it('holds command pipes until the forks pool cancels the worker', async () => {
  const root = process.env.WORKSPACE_FIXTURE_ROOT;
  if (root === undefined) throw new Error('A fixture root is required.');
  const workspace = preparePackedWorkspace(root);
  const probe = startWorkspaceProbe(workspace, 'escaped');
  const pids = await probe.ready;
  const ps = join(workspace.pnpmDirectory, 'ps');
  writeFileSync(ps, `#!${process.execPath}\nprocess.exit(1);\n`);
  chmodSync(ps, 0o755);
  process.env.PATH = `${workspace.pnpmDirectory}${delimiter}${process.env.PATH ?? ''}`;
  console.log(
    `WORKSPACE_READY ${JSON.stringify({ workspace: workspace.workspace, workerPid: process.pid, ...pids })}`,
  );
  await probe.result;
});
