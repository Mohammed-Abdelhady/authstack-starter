import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { copySyncTemplateInputs, trackAll } from '../support/sync-template-fixture.js';

it('excludes runtime artifacts and prohibited names before copying template files', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'cna-template-exclusions-'));
  const script = join(fixture, 'packages/create-nest-next-auth/scripts/sync-template.mjs');
  const artifacts = [
    'output/playwright/sentinel.txt',
    'backend/test-results/sentinel.txt',
    'frontend/playwright-report/sentinel.txt',
    'blob-report/sentinel.txt',
    'frontend/.auth/sentinel.json',
    '.mongodb-binaries/sentinel.txt',
    'mongodb-memory-server/sentinel.txt',
    '.env.synthetic',
    'backend/.env.extra.example',
  ];
  const kept = [
    'README.md',
    'frontend/e2e/fixtures/source.ts',
    '.env.docker.example',
    'backend/.env.example',
    'frontend/.env.example',
  ];
  try {
    copySyncTemplateInputs(fixture);
    for (const path of [...artifacts, ...kept]) {
      mkdirSync(dirname(join(fixture, path)), { recursive: true });
      writeFileSync(join(fixture, path), 'synthetic sentinel\n');
    }
    writeFileSync(join(fixture, 'template.manifest.json'), '{"features":{}}');
    trackAll(fixture);
    execFileSync(process.execPath, [script], { timeout: 10_000, stdio: 'pipe' });
    const template = join(fixture, 'packages/create-nest-next-auth/template');
    for (const path of artifacts) expect(existsSync(join(template, path)), path).toBe(false);
    for (const path of kept) expect(existsSync(join(template, path)), path).toBe(true);

    const prohibited = [
      'fixture.pem',
      'fixture.key',
      'fixture.crt',
      '.ssh',
      '.aws',
      '.kube',
      'ssl',
      '.config/gcloud',
    ];
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
        import { pathToFileURL } from 'node:url';
        const { isExcluded } = await import(pathToFileURL(process.argv[2]).href);
        const paths = JSON.parse(process.argv[3]);
        console.log(JSON.stringify(paths.map(path => isExcluded(path, path.split('/').pop(), !/[.](pem|key|crt)$/.test(path)))));
      `,
        process.execPath,
        script,
        JSON.stringify(prohibited),
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(JSON.parse(output)).toEqual(prohibited.map(() => true));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
