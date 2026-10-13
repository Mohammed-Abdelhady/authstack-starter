import { readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { isRecord } from '../../src/manifest/read.js';
import { listFiles } from '../../src/utils/fs.js';
import { PACKAGE_DIR, scaffold, type Packed } from './packed-cli.js';

const REPOSITORY_ROOT = join(PACKAGE_DIR, '../..');
const WORKFLOW_DIRECTORY = '.github/workflows';
const GATES_PATH = 'scripts/ci/gates.json';
const ENFORCEMENT_PATHS = [
  '.husky/pre-commit',
  '.husky/pre-push',
  '.husky/commit-msg',
  GATES_PATH,
  'scripts/check-hard-bans.mjs',
  'scripts/guardrails/scanner/cli.mjs',
  'scripts/ci.mjs',
];

// commit-msg and CLAUDE.md keep their shared contracts and must not differ.
const STANDARD_DIFFERENCES = [
  '.create-authstack-starter.json', // Records the chosen policy.
  '.github/workflows/ci.yml', // Removes the range-scan job.
  '.github/workflows/trusted-scan.yml', // Strict-only trusted scanning.
  '.husky/pre-commit', // Removes staged scanning.
  '.husky/pre-push', // Removes push scanning.
  'AGENTS.md', // Renders the chosen policy and its enforcement facts.
  'docs/README.md', // Describes local checks without hard-ban hooks.
  'docs/reference/code-quality.md', // Directs standard users to their generated rules.
  'package.json', // Removes scanner scripts and check's scanner command.
  GATES_PATH, // Removes the full-tree scan gate.
];

function sourceEnforcementBytes(path: string): Buffer {
  const bytes = readFileSync(join(REPOSITORY_ROOT, path));
  if (path === GATES_PATH) {
    const config: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(config) || !Array.isArray(config.gates)) {
      throw new Error(`${path}: source must contain a gate list`);
    }
    // Only maintainer gates are excluded from generated projects. Preserve the
    // order and every field of the shipped gates, using the template JSON format.
    const shipped: unknown[] = config.gates.flatMap((gate: unknown) => {
      if (!isRecord(gate)) throw new Error(`${path}: source gate must be an object`);
      if (gate.repositoryOnly === true) return [];
      const kept = { ...gate };
      delete kept.repositoryOnly;
      return [kept];
    });
    // A group left with no gate is not a group of a generated project.
    config.gates = shipped;
    if (Array.isArray(config.groups)) {
      config.groups = config.groups.filter((group: unknown) =>
        shipped.some((gate) => isRecord(gate) && gate.group === group),
      );
    }
    return Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
  }
  if (!path.startsWith(`${WORKFLOW_DIRECTORY}/`)) return bytes;
  // The template adds main for generated repositories and strips marked
  // maintainer jobs. No feature markers occur in these enforcement files.
  const content = bytes
    .toString('utf8')
    .replaceAll('branches: [staging, master]', 'branches: [staging, master, main]')
    .replace(/^ *# repository-only:start\n[\s\S]*?^ *# repository-only:end\n/gm, '');
  return Buffer.from(content);
}

export function rulesContractCases(getPacked: () => Packed): void {
  it.each(['standard', 'minimal'])(
    'preserves every strict enforcement file from the repository template for %s',
    async (preset) => {
      const packed = getPacked();
      const name = `strict-enforcement-${preset}`;
      const result = scaffold(packed, name, undefined, { flags: ['--preset', preset] });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const project = join(packed.workspace, name);
      const workflows = (await listFiles(join(REPOSITORY_ROOT, WORKFLOW_DIRECTORY))).map(
        (path) => `${WORKFLOW_DIRECTORY}/${path}`,
      );
      for (const path of [...ENFORCEMENT_PATHS, ...workflows]) {
        expect(
          readFileSync(join(project, path)),
          `${path}: strict must preserve template enforcement bytes`,
        ).toEqual(sourceEnforcementBytes(path));
      }
    },
  );

  it('changes only the documented paths between strict and standard', async () => {
    const packed = getPacked();
    // Reuse the same target name so package.json comparisons need no masking.
    // Move the first output aside before generating the second from this pack.
    const standard = join(packed.workspace, 'level-project');
    const strict = join(packed.workspace, 'strict-level-project');
    for (const level of ['strict', 'standard']) {
      const result = scaffold(packed, 'level-project', undefined, {
        flags: ['--rules', level],
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      if (level === 'strict') renameSync(standard, strict);
    }
    const strictPaths = new Set(await listFiles(strict));
    const standardPaths = new Set(await listFiles(standard));
    const paths = new Set([...strictPaths, ...standardPaths]);
    const differences: string[] = [];
    for (const path of [...paths].sort()) {
      if (
        !strictPaths.has(path) ||
        !standardPaths.has(path) ||
        !readFileSync(join(strict, path)).equals(readFileSync(join(standard, path)))
      ) {
        differences.push(path);
      }
    }
    expect(differences, 'Unexpected changed, strict-only or standard-only paths').toEqual(
      STANDARD_DIFFERENCES,
    );
  });
}
