import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { runTool } from '../support/combination-helpers.js';
import { createDescendantPipe, DESCENDANT_PIPE_ENV } from '../support/descendant-pipe.js';

const DESCENDANT = fileURLToPath(
  new URL('../packed/fixtures/workspace-descendant.ts', import.meta.url),
);

describe('asynchronous combination tools', () => {
  it('keeps worker timers responsive while a child runs', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    try {
      const result = await runTool(process.execPath, [
        '-e',
        "setTimeout(() => console.log('finished'), 100)",
      ]);
      expect(result).toEqual({ ok: true, output: 'finished\n', stdout: 'finished\n' });
      expect(ticks).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
    }
  });
  it('reports nonzero exits with diagnostic output', async () => {
    const result = await runTool(process.execPath, [
      '-e',
      "console.error('fixture failure'); process.exitCode = 7",
    ]);
    expect(result.ok).toBe(false);
    expect(result.output.split('\n').filter((line) => line === 'fixture failure')).toHaveLength(1);
  });
  it('retains stdout-only compiler diagnostics on a nonzero exit', async () => {
    const diagnostic = 'src/example.ts(1,1): error TS2322: Type mismatch';
    const encoded = Buffer.from(diagnostic).toString('hex');
    const result = await runTool(process.execPath, [
      '-e',
      `console.log(Buffer.from('${encoded}', 'hex').toString()); process.exitCode = 2`,
    ]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Command failed:');
    expect(result.output.split('\n').filter((line) => line === diagnostic)).toHaveLength(1);
  });
  it('terminates a timed out child', async () => {
    const result = await runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeout: 50,
    });
    expect(result.ok).toBe(false);
  });
  it('ends everything a timed out command started, before it answers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cna-command-death-'));
    const death = createDescendantPipe(root);
    const resources: { pid?: number } = {};
    onTestFinished(() => {
      try {
        if (resources.pid !== undefined) process.kill(resources.pid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
      } finally {
        death.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
    // The command starts a child that would run for an hour, and says its id.
    const script = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['--experimental-strip-types', ${JSON.stringify(DESCENDANT)}], { stdio: 'inherit' }); console.log(child.pid); setInterval(() => {}, 3600000);`;

    const command = runTool(process.execPath, ['-e', script], {
      timeout: 2000,
      env: { [DESCENDANT_PIPE_ENV]: death.path },
    });
    await death.ready;
    const result = await command;
    const pid = Number.parseInt(/^(\d+)$/m.exec(result.output)?.[1] ?? '', 10);

    resources.pid = pid;
    expect({ ok: result.ok, started: Number.isInteger(pid) }).toEqual({ ok: false, started: true });
    expect(await death.ended).toBe('eof');
    expect(result.output).toContain('Timed out after 2000 ms');
  }, 20_000);
  it('does not start a command whose signal was aborted already', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cna-run-tool-'));
    const marker = join(root, 'ran');
    try {
      const result = await runTool(
        process.execPath,
        ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`],
        { signal: AbortSignal.abort() },
      );

      expect({ ok: result.ok, ran: existsSync(marker) }).toEqual({ ok: false, ran: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('terminates a cancelled child', async () => {
    const result = await runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: AbortSignal.timeout(50),
    });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/abort/i);
  });
});
