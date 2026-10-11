import { spawn } from 'node:child_process';
import { commandEnvironment } from '../../src/utils/exec.js';

export const BUILD_TIMEOUT = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface CommandResult {
  ok: boolean;
  output: string;
}

export interface ToolOptions {
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/** The process groups of the commands still running, ended if this process exits first. */
const running = new Set<number>();

function endGroup(pid: number): void {
  try {
    // A negative id names the group: the command and everything it started.
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is gone already.
  }
}

process.once('exit', () => {
  for (const pid of running) endGroup(pid);
});

/**
 * Runs a command in a process group of its own and answers when it and every
 * process that shares its output have ended. A timeout or an aborted signal
 * ends the whole group, so a timed-out package manager leaves no test runner
 * behind it.
 */
export function runTool(
  executable: string,
  args: string[],
  options: ToolOptions = {},
): Promise<CommandResult> {
  const command = `${executable} ${args.join(' ')}`;
  if (options.signal?.aborted) {
    return Promise.resolve({
      ok: false,
      output: `Command failed: ${command}\nAborted before start`,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...commandEnvironment(), ...options.env, npm_config_update_notifier: 'false' },
    });
    const output = { stdout: '', stderr: '' };
    let ended: string | undefined;
    const end = (reason: string): void => {
      ended ??= reason;
      if (child.pid !== undefined) endGroup(child.pid);
    };
    if (child.pid !== undefined) running.add(child.pid);
    const timeoutMs = options.timeout ?? BUILD_TIMEOUT;
    const timer = setTimeout(() => end(`Timed out after ${timeoutMs} ms`), timeoutMs);
    const onAbort = (): void => end('Aborted');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (chunk: string) => {
        output[stream] += chunk;
        if (output.stdout.length + output.stderr.length > MAX_OUTPUT_BYTES) {
          end(`Wrote more than ${MAX_OUTPUT_BYTES} bytes`);
        }
      });
    }

    let exit: number | null = null;
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('exit', (code) => {
      exit = code;
    });
    // `close` comes after every holder of the pipes has ended, children included.
    child.once('close', () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (child.pid !== undefined) running.delete(child.pid);
      if (ended === undefined && spawnError === undefined && exit === 0) {
        resolve({ ok: true, output: `${output.stdout}${output.stderr}` });
        return;
      }
      const reason = ended ?? spawnError?.message ?? `Exit code ${String(exit)}`;
      resolve({
        ok: false,
        output: [`Command failed: ${command}\n${reason}`, output.stdout, output.stderr]
          .map((part) => part.trimEnd())
          .filter(Boolean)
          .join('\n'),
      });
    });
  });
}
