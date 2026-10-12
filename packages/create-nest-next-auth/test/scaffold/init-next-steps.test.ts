import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripFeatureMarkers } from '../../src/prune/markers.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SOURCE_FILE = 'scripts/lib/init-next-steps.js';

interface NextStepsConfig {
  appTitle: string;
  env: { frontendPort: number; backendPort: number };
}

const CONFIG: NextStepsConfig = {
  appTitle: 'App',
  env: { frontendPort: 3000, backendPort: 5000 },
};

async function loadBuilder(): Promise<(config: NextStepsConfig) => string[]> {
  // The repo's unpruned module, loaded at runtime so no marker is stripped.
  const moduleUrl = pathToFileURL(join(REPO_ROOT, SOURCE_FILE)).href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
    buildNextStepLines: (config: NextStepsConfig) => string[];
  };
  return loaded.buildNextStepLines;
}

/**
 * Strips the given options the way the pruner does, then loads the result from
 * a data URL with the relative `cli-utils.js` import made absolute.
 */
async function loadPrunedBuilder(kept: string[]): Promise<(config: NextStepsConfig) => string[]> {
  const source = await readFile(join(REPO_ROOT, SOURCE_FILE), 'utf8');
  const stripped = stripFeatureMarkers(
    source,
    SOURCE_FILE,
    new Set(kept),
    new Set(['docker', 'production']),
  ).content;
  const cliUtils = pathToFileURL(join(REPO_ROOT, 'scripts/lib/cli-utils.js')).href;
  const patched = stripped.replace("'./cli-utils.js'", JSON.stringify(cliUtils));
  const url = `data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`;
  const loaded = (await import(/* @vite-ignore */ url)) as {
    buildNextStepLines: (config: NextStepsConfig) => string[];
  };
  return loaded.buildNextStepLines;
}

const ESCAPE = String.fromCharCode(27);

/** Drops ANSI SGR sequences without a control character in the source. */
function stripAnsi(line: string): string {
  return line
    .split(ESCAPE)
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('m') + 1)))
    .join('');
}

describe('init script next steps', () => {
  it('prints no marker text from the unpruned template', async () => {
    const build = await loadBuilder();
    const output = build(CONFIG).join('\n');

    expect(output).not.toContain('feature:');
    expect(output).not.toContain('docker:start');
    expect(output).not.toContain('production:start');
    expect(output).toContain('# With Docker (recommended)');
    expect(output).toContain('For production deployment:');
    expect(output).toContain('# Run them locally:');
    expect(output).not.toContain('# Or');
  });

  it('prints the replica-set step and no stray blank line when docker is off', async () => {
    const build = await loadPrunedBuilder([]);
    const lines = build(CONFIG);
    const plain = lines.map(stripAnsi);
    const output = plain.join('\n');

    expect(output).toContain(
      '# Start a single-node replica set first (sign-in uses transactions):',
    );
    expect(output).toContain('mkdir -p ./mongodb-data');
    expect(output).toContain('mongod --replSet rs0 --dbpath ./mongodb-data');
    expect(output).toContain('# leave mongod running, then in a second terminal:');
    expect(output).toContain('mongosh --eval "rs.initiate()"');
    expect(output).not.toContain('# With Docker (recommended)');
    expect(output.indexOf('mkdir -p ./mongodb-data')).toBeLessThan(
      output.indexOf('mongod --replSet rs0 --dbpath ./mongodb-data'),
    );
    expect(output.indexOf('second terminal')).toBeLessThan(
      output.indexOf('mongosh --eval "rs.initiate()"'),
    );

    const start = plain.indexOf('  3. Start the development servers:');
    expect(plain[start + 1]).toBe('     # Run them locally:');
  });
});
