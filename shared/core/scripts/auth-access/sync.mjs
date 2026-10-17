import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { assertLocalPath } from './paths.mjs';
import { backendPaths, loadBackendTools, loadHostValues, readHostSource } from './backend.mjs';
import {
  assertCandidateTypes,
  assertSelfContainedContract,
  candidateSource,
} from './candidate.mjs';

async function outputState(output) {
  let stat;
  try {
    stat = await lstat(output);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Host access output must be a regular file');
  return stat;
}

export async function writeCatalogue(output, source, { move = rename, create = open } = {}) {
  const stat = await outputState(output);
  const temp = join(dirname(output), `.auth-access-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await create(temp, 'wx', stat ? stat.mode & 0o777 : 0o644);
    await handle.writeFile(source);
    await handle.close();
    await move(temp, output);
  } finally {
    if (handle) {
      await handle.close();
      await unlink(temp).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}

export async function syncHostAccess({ root, check = false, tools }) {
  const paths = backendPaths(root);
  const output = join(root, 'shared/core/src/host-access.ts');
  for (const path of [
    output,
    paths.access,
    paths.contract,
    paths.project,
    paths.manifest,
    paths.loader,
  ])
    await assertLocalPath(root, path);
  await outputState(output);
  const runtime = tools ?? (await loadBackendTools(paths));
  const contract = readHostSource(paths);
  assertSelfContainedContract(runtime.ts, contract);
  const candidate = candidateSource(contract, loadHostValues(paths));
  assertCandidateTypes(runtime.ts, candidate, output);
  const source = await runtime.format(candidate, output);
  let previous;
  try {
    previous = await readFile(output, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (source === previous) return { changed: false };
  if (check) throw new Error('Host access copy is stale; run pnpm auth:access');
  await writeCatalogue(output, source);
  return { changed: true };
}
