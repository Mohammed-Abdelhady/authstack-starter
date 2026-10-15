import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const PS_STUB_KEEPALIVE_MS = 60_000;
const PS_STUB_WARMUP_TIMEOUT_MS = 5000;

export function installFixturePs(
  directory: string,
  mode: string,
  pids: { pid: number; descendantPid: number },
): void {
  if (mode === 'system') return;
  const node = `'${process.execPath.replace(/'/g, "'\\''")}'`;
  const bodies: Record<string, string> = {
    working: `printf '%s\\n' '${pids.pid} ${process.pid} ${pids.pid}' '${pids.descendantPid} ${pids.pid} ${pids.descendantPid}'\n`,
    failing: 'exit 1\n',
    timeout: `exec ${node} -e 'setInterval(() => {}, ${PS_STUB_KEEPALIVE_MS})'\n`,
  };
  const body = bodies[mode];
  if (body === undefined) throw new Error(`Unknown ps fixture mode: ${mode}`);
  const stub = join(directory, 'ps');
  writeFileSync(stub, `#!/bin/sh\n${body}`, { mode: 0o755 });
  if (mode === 'working') {
    // macOS checks a new executable on first exec; pay it here so the 200 ms ps bound stays.
    execFileSync(stub, [], {
      stdio: 'ignore',
      timeout: PS_STUB_WARMUP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  }
  process.env.PATH = `${directory}${delimiter}${process.env.PATH ?? ''}`;
}
