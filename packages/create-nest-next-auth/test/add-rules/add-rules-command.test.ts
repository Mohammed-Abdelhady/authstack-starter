import { afterEach, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { addRulesCommand } from '../../src/add-rules/command.js';
import { join } from 'node:path';
import {
  cleanRulesFixtures,
  fixtureGit,
  rulesFixture,
  rulesInstallerFixture,
} from './add-rules-fixture.js';

const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const ui = vi.hoisted(() => ({ lines: [] as string[], confirmation: false, missingGit: false }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: import('node:child_process').SpawnOptions) =>
      actual.spawn(
        ui.missingGit && command === '/usr/bin/git'
          ? join(String(options.cwd), 'missing-git')
          : command,
        args,
        options,
      ),
  };
});
vi.mock('@clack/prompts', () => ({
  log: {
    message: (message: string) => ui.lines.push(message),
    error: (message: string) => ui.lines.push(message),
  },
  note: (message: string) => ui.lines.push(message),
  outro: (message: string) => ui.lines.push(message),
  confirm: () => Promise.resolve(ui.confirmation),
  isCancel: () => false,
}));
afterEach(async () => {
  vi.restoreAllMocks();
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  ui.lines = [];
  ui.missingGit = false;
  await cleanRulesFixtures();
});
it('refuses with the Git inspection reason and no writes when the system Git is absent', async () => {
  const root = await rulesFixture();
  const installer = await rulesInstallerFixture();
  fixtureGit(root, ['init', '--quiet']);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  ui.missingGit = true;
  expect({
    code: await addRulesCommand(['--yes'], '1.0.0', installer),
    entries: (await readdir(root)).sort(),
    reason: ui.lines.some(
      (line) => line.includes('Could not inspect Git repository hooks:') && line.includes('ENOENT'),
    ),
  }).toEqual({ code: 2, entries: ['.git', 'package.json'], reason: true });
});
it.each(['dry-run', 'noninteractive', 'declined', 'yes'] as const)(
  'handles %s without running project code',
  async (mode) => {
    const root = await rulesFixture();
    const installer = await rulesInstallerFixture();
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: mode === 'declined',
    });
    const argv = mode === 'dry-run' ? ['--dry-run'] : mode === 'yes' ? ['--yes'] : [];
    const code = await addRulesCommand(argv, '1.0.0', installer);
    expect({
      code,
      written: (await readdir(root)).includes('AGENTS.md'),
      planDisplayed: ui.lines.some((line) => line.includes('--- .husky/pre-commit ---')),
      checks: ui.lines.some((line) => line.includes('Checks run: none')),
    }).toEqual({
      code: mode === 'noninteractive' ? 2 : 0,
      written: mode === 'yes',
      planDisplayed: true,
      checks: true,
    });
  },
);
