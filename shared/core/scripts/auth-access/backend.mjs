import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function backendPaths(root) {
  const directory = join(root, 'backend');
  const paths = {
    directory,
    loader: join(directory, 'scripts/host-access-tools.mjs'),
    manifest: join(directory, 'package.json'),
    project: join(directory, 'tsconfig.json'),
    access: join(directory, 'src/host/access.ts'),
    contract: join(directory, 'src/host/types/host-role.type.ts'),
  };
  for (const path of [paths.manifest, paths.project, paths.access, paths.contract]) {
    if (!existsSync(path))
      throw new Error('Backend source is missing; run auth:access in the API checkout');
  }
  return paths;
}

export async function loadBackendTools(paths) {
  const { loadBackendTools: load } = await import(pathToFileURL(paths.loader).href);
  return load(paths);
}

export function readHostSource(paths) {
  return readFileSync(paths.contract, 'utf8').replace(/\r\n?/gu, '\n');
}

export function loadHostValues(paths) {
  const require = createRequire(paths.manifest);
  return require(paths.access);
}
