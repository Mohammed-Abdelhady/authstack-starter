import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import { buildTemplate } from '../support/sync-template-fixture.js';

const roots: string[] = [];
const DOC_PATH = 'docs/reference/code-quality.md';
const POLICY_PATH = 'scripts/guardrails/policy.mjs';
const ROOT_ONLY_START = '<!-- repository-only:start -->';
const ROOT_ONLY_END = '<!-- repository-only:end -->';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function copyContent(path: string, content: string): string {
  return buildTemplate(roots, (fixture) => {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    writeFileSync(join(fixture, path), content);
  });
}

function identity(template: string): unknown {
  const data: unknown = JSON.parse(
    readFileSync(join(dirname(template), TEMPLATE_IDENTITY_FILE), 'utf8'),
  );
  return (data as { sha256: unknown }).sha256;
}

describe('generated guardrail content', () => {
  it('keeps policy data exempt and removes exemptions for absent regression tests', () => {
    const template = copyContent(
      POLICY_PATH,
      "export const EXEMPT_PATHS = ['scripts/guardrails/policy.mjs', 'scripts/guardrails/scanner/check-hard-bans.test.mjs'];\n",
    );
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { EXEMPT_PATHS } from './${POLICY_PATH}'; console.log(JSON.stringify(EXEMPT_PATHS));`,
      ],
      { cwd: template, encoding: 'utf8' },
    );
    expect(JSON.parse(output)).toEqual(['scripts/guardrails/policy.mjs']);
  });

  it('copies applicable instructions and omits repository-only tooling', () => {
    const template = copyContent(
      DOC_PATH,
      `Run the checker.\n${ROOT_ONLY_START}\nRoot policy suites.\n${ROOT_ONLY_END}\nRun application tests.\n`,
    );
    expect(readFileSync(join(template, DOC_PATH), 'utf8')).toBe(
      'Run the checker.\nRun application tests.\n',
    );
  });

  it('omits repository setup from the shipped root README', () => {
    const template = copyContent(
      'README.md',
      `# App\n${ROOT_ONLY_START}\ngit clone repository\npnpm install --frozen-lockfile\n${ROOT_ONLY_END}\npnpm install\n`,
    );
    expect(readFileSync(join(template, 'README.md'), 'utf8')).toBe('# App\npnpm install\n');
  });

  it('hashes shipped bytes rather than omitted documentation', () => {
    const first = copyContent(DOC_PATH, `Keep.\n${ROOT_ONLY_START}\nFirst.\n${ROOT_ONLY_END}\n`);
    const second = copyContent(DOC_PATH, `Keep.\n${ROOT_ONLY_START}\nSecond.\n${ROOT_ONLY_END}\n`);
    const changed = copyContent(
      DOC_PATH,
      `Changed.\n${ROOT_ONLY_START}\nFirst.\n${ROOT_ONLY_END}\n`,
    );
    expect([identity(first), identity(second), identity(changed)]).toEqual([
      '8f819e4ebc6bbcc3bef4e9062ebedc680b1d380f7acf97ccecac9d0d97bcf181',
      '8f819e4ebc6bbcc3bef4e9062ebedc680b1d380f7acf97ccecac9d0d97bcf181',
      '39d773812a505e4f3d5f5211e62d352b67966eb19b81eed80153ac270ff22439',
    ]);
  });
});
