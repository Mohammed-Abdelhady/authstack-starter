import type { SetupSummary } from '../types/setup.js';

/** The final facts are printed only from the scaffold result. */
export function renderSetupSummary(summary: SetupSummary): string[] {
  return [
    `Files written: ${summary.files.count}`,
    ...(summary.files.paths ? [`Written paths: ${summary.files.paths.join(', ') || 'none'}`] : []),
    `Instruction files: ${summary.files.instructions.join(', ') || 'none'}`,
    `Rules: ${summary.rules}`,
    `Lockfile: ${summary.lockfile.status}${summary.lockfile.reason ? `. ${summary.lockfile.reason}` : ''}`,
    `Git repository and first commit: ${summary.git.status}${summary.git.reason ? `. ${summary.git.reason}` : ''}`,
    `Dependencies: ${summary.install.status}${summary.install.reason ? `. ${summary.install.reason}` : ''}`,
    `Hooks: ${summary.hooks.active ? 'active' : summary.hooks.included ? 'inactive' : 'not included'}`,
    ...(summary.hooks.activationCommand
      ? [`Activate hooks: ${summary.hooks.activationCommand}`]
      : []),
    `Checks run: ${summary.checksRun.join(', ') || 'none'}`,
    ...(summary.notAdded ?? []).map(({ check, reason }) => `Not added: ${check}. ${reason}`),
    ...(summary.skipped.length ? ['Skipped:'] : []),
    ...summary.skipped.map(({ check, reason }) => `  ${check}: ${reason}`),
  ];
}
