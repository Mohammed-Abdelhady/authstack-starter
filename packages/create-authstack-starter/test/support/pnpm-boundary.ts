import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_MANAGER_VERSION } from '../../src/constants/index.js';

/** Synthetic executable at the child-process boundary, never installs packages. */
export async function writePnpmBoundary(
  directory: string,
  failure = '',
  version = PACKAGE_MANAGER_VERSION,
  touchLockfile = false,
  removedImporters: string[] = [],
): Promise<void> {
  const executable = join(directory, 'pnpm');
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2).join(' ');
fs.appendFileSync(${JSON.stringify(join(directory, 'calls'))}, args + '\\n');
if (args === '--version') {
  process.stdout.write(${JSON.stringify(version)} + '\\n');
  process.exit(0);
}
if (${JSON.stringify(touchLockfile)} && args === 'install --lockfile-only') {
  fs.appendFileSync(require('node:path').join(process.cwd(), 'pnpm-lock.yaml'), '\\n# refreshed before commit\\n');
}
if (args === 'install --lockfile-only' && ${JSON.stringify(removedImporters)}.length > 0) {
  const path = require('node:path').join(process.cwd(), 'pnpm-lock.yaml');
  const lines = fs.readFileSync(path, 'utf8').split('\\n');
  for (const importer of ${JSON.stringify(removedImporters)}) {
    const start = lines.indexOf('  ' + importer + ':');
    if (start === -1) continue;
    let end = start + 1;
    while (end < lines.length && !/^(?:  [^ ]|[^ #][^:]*:|---$)/.test(lines[end])) end += 1;
    lines.splice(start, end - start);
  }
  fs.writeFileSync(path, lines.join('\\n'));
}
if (args.includes(${JSON.stringify(failure || 'never-fails')})) {
  process.stderr.write('registry refused the request');
  process.exit(1);
}
`,
  );
  await chmod(executable, 0o755);
}
