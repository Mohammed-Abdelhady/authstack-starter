import type { DanglingReference, Manifest, PruneResult } from './types.js';

export function describeSelection(manifest: Manifest, result: PruneResult): string[] {
  const label = (id: string): string => manifest.features[id]?.label ?? id;
  // Hidden features ride along with the ones that require them, so naming them
  // here would only be noise.
  const named = (id: string): boolean => manifest.features[id]?.kind !== 'hidden';
  const lines = [`Included: ${result.selected.filter(named).map(label).join(', ')}`];

  const removedAvailable = result.removed.filter(
    (id) => named(id) && manifest.features[id]?.status !== 'planned',
  );
  if (removedAvailable.length > 0) {
    lines.push(`Removed: ${removedAvailable.map(label).join(', ')}`);
  }
  if (result.removedOptions.length > 0) {
    const optionLabel = (id: string): string => manifest.options[id]?.label ?? id;
    lines.push(`Removed options: ${result.removedOptions.map(optionLabel).join(', ')}`);
  }
  if (result.deletedFiles.length > 0) {
    lines.push(`Deleted ${result.deletedFiles.length} files`);
  }
  if (result.markedFiles.length > 0) {
    lines.push(`Edited ${result.markedFiles.length} files around their feature markers`);
  }
  if (result.strippedEnvVars.length > 0) {
    lines.push(`Stripped ${result.strippedEnvVars.length} env vars from the examples`);
  }
  return lines;
}

/** The message printed when pruning leaves references pointing at deleted files. */
export function describeDangling(dangling: DanglingReference[]): string[] {
  const lines = [
    'The generated project still references files that were removed with the unselected features and options.',
    'Add the shared files to the manifest, or make the code load providers dynamically.',
    '',
  ];
  for (const reference of dangling) {
    if (reference.script !== undefined) {
      lines.push(
        `${reference.file} runs "${reference.script}", which uses removed ${reference.target}`,
      );
      continue;
    }
    lines.push(`${reference.file}:${reference.line} imports ${reference.specifier}`);
  }
  return lines;
}

/** The message printed when a database rule found nothing to change in a project with everything on. */
export function describeUnexplainedRules(rules: string[]): string[] {
  return [
    'The installer is inconsistent: these database rules found nothing to change, and nothing was left out that could explain it.',
    'This is a fault in the installer, not in your choices. Please report it with the list below.',
    '',
    ...rules,
  ];
}

/** Missing rule targets in a project that removed other template content. */
export function describePossiblyPrunedRules(rules: string[]): string[] {
  return [
    'These database rules found nothing to change. A removed feature, option, client or the selected rules policy may explain a missing target. Check entries whose target remains in this project:',
    ...rules,
  ];
}
