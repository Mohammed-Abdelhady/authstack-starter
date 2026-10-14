import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePackedWorkspace } from '../packed-workspace.js';
import { startWorkspaceProbe } from '../workspace-probe.js';

const root = process.argv[2];
if (root === undefined) throw new Error('A fixture root is required.');
const workspace = preparePackedWorkspace(root);
const probe = startWorkspaceProbe(workspace, process.argv[3]);
const pids = await probe.ready;
if (process.argv[3] === 'escaped') {
  const ps = join(workspace.pnpmDirectory, 'ps');
  writeFileSync(ps, `#!${process.execPath}\nprocess.exit(1);\n`);
  chmodSync(ps, 0o755);
  process.env.PATH = workspace.pnpmDirectory;
}
process.stdout.write(`${JSON.stringify({ workspace: workspace.workspace, ...pids })}\n`);
process.send?.({ workspace: workspace.workspace, ...pids });
void probe.result;
