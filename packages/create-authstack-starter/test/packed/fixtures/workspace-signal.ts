import { preparePackedWorkspace } from '../packed-workspace.js';
import { startWorkspaceProbe } from '../workspace-probe.js';
import { installFixturePs } from './workspace-ps.js';

const root = process.argv[2];
if (root === undefined) throw new Error('A fixture root is required.');
const workspace = preparePackedWorkspace(root);
const probe = startWorkspaceProbe(workspace, process.argv[3]);
const pids = await probe.ready;
installFixturePs(workspace.pnpmDirectory, process.argv[4] ?? 'system', pids);
process.stdout.write(`${JSON.stringify({ workspace: workspace.workspace, ...pids })}\n`);
process.send?.({ workspace: workspace.workspace, ...pids });
void probe.result;
