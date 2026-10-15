import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_ARTIFACT = /(^|[./\\_-])(tests?|__tests__|spec|harness|fixtures?|mocks?)(?=[./\\_-]|$)/i;
const CODE_FILE = /\.(?:[cm]?js|d\.[cm]?ts)$/;
const TEST_DEPENDENCY = /\bjest\b|['"]@nestjs\/testing(?:\/[^'"]*)?['"]/;
const DIST = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../backend/dist/', import.meta.url));

function checkSourceMap(file, relativePath) {
  const map = JSON.parse(readFileSync(file, 'utf8'));
  for (const source of map.sources ?? []) {
    const origin = `${map.sourceRoot ?? ''}/${source}`;
    if (TEST_ARTIFACT.test(origin)) {
      throw new Error(`test source ${origin} in ${relativePath}`);
    }
  }
}

function checkDirectory(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (TEST_ARTIFACT.test(relativePath)) {
      throw new Error(`test artifact dist/${relativePath}`);
    }
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      checkDirectory(file, relativePath);
    } else if (entry.isFile()) {
      if (CODE_FILE.test(entry.name) && TEST_DEPENDENCY.test(readFileSync(file, 'utf8'))) {
        throw new Error(`test dependency in dist/${relativePath}`);
      }
      if (entry.name.endsWith('.map')) checkSourceMap(file, relativePath);
    }
  }
}

try {
  for (const entry of ['main.js', 'cli/audience-apply.js']) {
    const artifact = join(DIST, entry);
    if (!existsSync(artifact) || !statSync(artifact).isFile()) {
      throw new Error(`dist/${entry} is missing or is not a file`);
    }
  }
  checkDirectory(DIST);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Backend build check failed: ${message.replace(/\s+/g, ' ')}`);
  process.exitCode = 1;
}
