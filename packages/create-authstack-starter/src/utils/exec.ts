import { spawn } from 'node:child_process';
import { GIT_REPOSITORY_ENV_PREFIXES, GIT_REPOSITORY_ENV_VARS } from '../constants/index.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell and collects its output. Never throws. */
export function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const env = commandEnvironment();
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function commandEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Package lifecycle scripts can spawn git too.
  for (const key of Object.keys(env)) {
    if (
      GIT_REPOSITORY_ENV_VARS.includes(key) ||
      GIT_REPOSITORY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      delete env[key];
    }
  }
  return env;
}

export function lastLines(text: string, count: number): string {
  return text.trimEnd().split('\n').slice(-count).join('\n');
}
