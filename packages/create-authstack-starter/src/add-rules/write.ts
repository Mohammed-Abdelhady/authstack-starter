import type { FileHandle } from 'node:fs/promises';
import type { RulesPlan } from '../types/add-rules.js';
import { inspectGit } from './git.js';
import { ProjectPaths } from './project-paths.js';

export async function writePlan(plan: RulesPlan): Promise<void> {
  if (plan.blockers.length) throw new Error(`Nothing written: ${plan.blockers.join('; ')}`);
  const paths = await ProjectPaths.open(plan.root);
  const handles: { path: string; handle: FileHandle }[] = [];
  try {
    for (const [path, exists] of plan.guards) {
      if ((await paths.exists(path)) !== exists)
        throw new Error(`Project setup changed after inspection: ${path}`);
    }
    if (
      plan.gitHooks !== undefined &&
      JSON.stringify(await inspectGit(plan.root)) !== JSON.stringify(plan.gitHooks)
    )
      throw new Error('Git hooks path changed after inspection.');
    for (const [path, original] of plan.observations) {
      if ((await paths.read(path)) !== original)
        throw new Error(`Project changed after inspection: ${path}`);
    }
    for (const file of plan.files) {
      if (await paths.exists(file.path))
        throw new Error(`File appeared after inspection: ${file.path}`);
    }
    for (const file of plan.files)
      handles.push({ path: file.path, handle: await paths.reserve(file.path) });
    for (let index = 0; index < handles.length; index++) {
      await paths.verify(handles[index].path, handles[index].handle);
      await handles[index].handle.writeFile(plan.files[index].content, 'utf8');
    }
    for (const { path, handle } of handles) await paths.verify(path, handle);
  } catch (error) {
    const failures: string[] = [];
    for (const { path, handle } of [...handles].reverse()) {
      try {
        await paths.discard(path, handle);
      } catch (cleanup) {
        failures.push(`${path}: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
      }
    }
    failures.push(...(await paths.discardDirectories()));
    if (failures.length)
      throw new Error(
        `Application failed: ${error instanceof Error ? error.message : String(error)}. Rollback needs attention: ${failures.join('; ')}`,
      );
    throw error;
  } finally {
    for (const { handle } of handles) await handle.close();
    await paths.close();
  }
}
