import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { pruneDependabot } from '../../src/prune/dependabot.js';

interface DependabotUpdate {
  'package-ecosystem': string;
  directory: string;
  'exclude-paths'?: string[];
  [setting: string]: unknown;
}

interface DependabotConfig {
  version: number;
  updates: DependabotUpdate[];
}

const NATIVE_EXCLUSIONS = [
  '# Managed by hand',
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  "    directory: '/'",
  '    exclude-paths:',
  '      - mobile/cli/package.json',
  '      - mobile/expo/package.json',
  '      - mobile/ui/package.json',
  '    schedule:',
  '      interval: weekly',
  '    groups:',
  '      dependencies:',
  "        patterns: ['*']",
  '        update-types:',
  '          - minor',
  '          - patch',
  '  - package-ecosystem: docker',
  '    directory: /backend',
  '    schedule:',
  '      interval: weekly',
  '    ignore:',
  "      - dependency-name: 'node'",
  '        versions:',
  "          - '23.x'",
  "          - '25.x'",
  "          - '27.x'",
  "          - '29.x'",
  '    groups:',
  '      docker:',
  "        patterns: ['*']",
  '        update-types:',
  '          - minor',
  '          - patch',
  '  - package-ecosystem: docker',
  '    directory: /frontend',
  '    schedule:',
  '      interval: weekly',
  '    ignore:',
  "      - dependency-name: 'node'",
  '        versions:',
  "          - '23.x'",
  "          - '25.x'",
  "          - '27.x'",
  "          - '29.x'",
  '    groups:',
  '      docker:',
  "        patterns: ['*']",
  '        update-types:',
  '          - minor',
  '          - patch',
  '  - package-ecosystem: docker',
  '    directory: /nginx',
  '    schedule:',
  '      interval: weekly',
  '    groups:',
  '      docker:',
  "        patterns: ['*']",
  '        update-types:',
  '          - minor',
  '          - patch',
  '  - package-ecosystem: github-actions',
  '    directory: /',
  '    schedule:',
  '      interval: weekly',
  '    groups:',
  '      actions:',
  "        patterns: ['*']",
  '',
].join('\n');

const FULL = [
  '# Managed by hand',
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  "    directory: '/'",
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: docker',
  '    directory: /backend',
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: docker',
  '    directory: /nginx',
  '    schedule:',
  '      interval: weekly',
  '',
].join('\n');

const WITHOUT_BACKEND = [
  '# Managed by hand',
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  "    directory: '/'",
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: docker',
  '    directory: /nginx',
  '    schedule:',
  '      interval: weekly',
  '',
].join('\n');

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-dependabot-'));
  roots.push(root);
  await mkdir(join(root, '.github'), { recursive: true });
  return root;
}

async function readConfig(root: string): Promise<DependabotConfig> {
  const content = await readFile(join(root, '.github/dependabot.yml'), 'utf8');
  return parse(content) as DependabotConfig;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('pruneDependabot', () => {
  it('removes only the entry whose Dockerfile was deleted, preserving the rest', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), FULL, 'utf8');

    await expect(pruneDependabot(root, ['backend/Dockerfile'])).resolves.toBe(true);

    expect(await readFile(join(root, '.github/dependabot.yml'), 'utf8')).toBe(WITHOUT_BACKEND);
  });

  it('removes a root-level docker entry when the root Dockerfile is deleted', async () => {
    const root = await tempRoot();
    const content = [
      'version: 2',
      'updates:',
      '  - package-ecosystem: docker',
      '    directory: /',
      '    schedule:',
      '      interval: weekly',
      '',
    ].join('\n');
    await writeFile(join(root, '.github/dependabot.yml'), content, 'utf8');

    await expect(pruneDependabot(root, ['Dockerfile'])).resolves.toBe(true);

    expect(await readFile(join(root, '.github/dependabot.yml'), 'utf8')).toBe(
      'version: 2\nupdates: []\n',
    );
  });

  it('rejects invalid YAML with the file name', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), 'updates: [\n', 'utf8');

    await expect(pruneDependabot(root, [])).rejects.toThrow(
      /Could not parse \.github\/dependabot\.yml/,
    );
  });

  it('removes all missing native manifest exclusions from a web-only config', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), NATIVE_EXCLUSIONS, 'utf8');

    await expect(
      pruneDependabot(root, [
        'mobile/cli/package.json',
        'mobile/expo/package.json',
        'mobile/ui/package.json',
      ]),
    ).resolves.toBe(true);

    const config = await readConfig(root);
    expect(config.updates).toEqual([
      {
        'package-ecosystem': 'npm',
        directory: '/',
        schedule: { interval: 'weekly' },
        groups: { dependencies: { patterns: ['*'], 'update-types': ['minor', 'patch'] } },
      },
      {
        'package-ecosystem': 'docker',
        directory: '/backend',
        schedule: { interval: 'weekly' },
        ignore: [{ 'dependency-name': 'node', versions: ['23.x', '25.x', '27.x', '29.x'] }],
        groups: {
          docker: { patterns: ['*'], 'update-types': ['minor', 'patch'] },
        },
      },
      {
        'package-ecosystem': 'docker',
        directory: '/frontend',
        schedule: { interval: 'weekly' },
        ignore: [{ 'dependency-name': 'node', versions: ['23.x', '25.x', '27.x', '29.x'] }],
        groups: {
          docker: { patterns: ['*'], 'update-types': ['minor', 'patch'] },
        },
      },
      {
        'package-ecosystem': 'docker',
        directory: '/nginx',
        schedule: { interval: 'weekly' },
        groups: {
          docker: { patterns: ['*'], 'update-types': ['minor', 'patch'] },
        },
      },
      {
        'package-ecosystem': 'github-actions',
        directory: '/',
        schedule: { interval: 'weekly' },
        groups: { actions: { patterns: ['*'] } },
      },
    ]);
    const output = await readFile(join(root, '.github/dependabot.yml'), 'utf8');
    expect(output).toContain('# Managed by hand');
    expect(output).toContain("    directory: '/'");
  });

  it('removes only the missing bare-shell exclusion for an Expo project', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), NATIVE_EXCLUSIONS, 'utf8');

    await expect(pruneDependabot(root, ['mobile/cli/package.json'])).resolves.toBe(true);

    const config = await readConfig(root);
    expect(config.updates[0]?.['exclude-paths']).toEqual([
      'mobile/expo/package.json',
      'mobile/ui/package.json',
    ]);
    expect(config.updates[0]?.groups).toEqual({
      dependencies: { patterns: ['*'], 'update-types': ['minor', 'patch'] },
    });
  });

  it('resolves exact exclusions from each npm directory and keeps globs and directories', async () => {
    const root = await tempRoot();
    const content = [
      'version: 2',
      'updates:',
      '  - package-ecosystem: npm',
      '    directory: /workspace',
      '    exclude-paths:',
      '      - ../mobile/cli/package.json',
      '      - mobile/cli/package.json',
      '      - mobile/**/package.json',
      '      - mobile/cli/',
      '  - package-ecosystem: npm',
      "    directory: '/'",
      '    exclude-paths:',
      '      - mobile/cli/package.json',
      '      - mobile/expo/package.json',
      '',
    ].join('\n');
    await writeFile(join(root, '.github/dependabot.yml'), content, 'utf8');

    await expect(pruneDependabot(root, ['mobile/cli/package.json'])).resolves.toBe(true);

    const config = await readConfig(root);
    expect(config.updates.map((entry) => entry['exclude-paths'])).toEqual([
      ['mobile/cli/package.json', 'mobile/**/package.json', 'mobile/cli/'],
      ['mobile/expo/package.json'],
    ]);
  });
});
