import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BROWSER_STACK_PACKAGES } from '../../src/constants/index.js';
import { findDanglingReferences } from '../../src/prune/references.js';
import { listFiles } from '../../src/utils/fs.js';
import { scaffold, type Packed } from './packed-cli.js';

const FEATURES = [
  'email-password',
  'google',
  'github',
  'facebook',
  'magic-link',
  'totp',
  'passkeys',
  'microsoft',
  'apple',
  'discord',
  'linkedin',
  'gitlab',
  'x',
  'slack',
  'twitch',
  'oidc',
];
const BROWSER_IMPORT = new RegExp(`['"](?:${BROWSER_STACK_PACKAGES.join('|')})(?:/[^'"]*)?['"]`);

export function installerDocCases(getPacked: () => Packed): void {
  it.each([...FEATURES, 'all'])(
    'ships valid docs and no browser stack for %s',
    async (selection) => {
      const packed = getPacked();
      const name = `docs-${selection}`;
      const result = scaffold(packed, name, selection === 'all' ? FEATURES.join(',') : selection);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const project = join(packed.workspace, name);
      const browserImports: string[] = [];
      for (const file of await listFiles(join(project, 'frontend'))) {
        if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
        if (BROWSER_IMPORT.test(await readFile(join(project, 'frontend', file), 'utf8')))
          browserImports.push(file);
      }
      expect({ dangling: await findDanglingReferences(project, []), browserImports }).toEqual({
        dangling: [],
        browserImports: [],
      });
    },
  );
}
