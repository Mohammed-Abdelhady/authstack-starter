import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { TEMPLATE_DIR_NAME } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import { resolveOwnership } from '../../src/manifest/ownership.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { prune } from '../../src/prune/index.js';
import { copyTemplate } from '../../src/scaffold/copy.js';
import type { Packed } from './packed-cli.js';

/**
 * Prunes the packed template for one database with everything else on, and
 * answers what the pruner said about that database's rules. This goes through
 * the pruner itself, because the command line does not print the list.
 */
async function pruneEverything(
  packed: Packed,
  database: string,
): Promise<{ errors: unknown[]; rules: number; unmatched: string[] }> {
  const root = dirname(dirname(packed.cli));
  const manifest = await loadManifest(root);
  const plan = resolvePlan(manifest, { preset: 'everything', databases: [database] });
  const target = join(packed.workspace, `database-rules-${database}`);
  await copyTemplate(join(root, TEMPLATE_DIR_NAME), target);

  const result = await prune(
    target,
    manifest,
    plan.features,
    plan.options,
    plan.rules,
    resolveOwnership(manifest, plan),
    [plan.database],
  );
  const chosen = manifest.databases[database];
  const others = Object.entries(manifest.databases).filter(([id]) => id !== database);
  return {
    errors: plan.errors,
    rules:
      chosen.rewrites.length +
      Object.keys(chosen.renames).length +
      Object.keys(chosen.scriptRenames).length +
      others.flatMap(([, other]) => [...other.packages, ...other.scripts]).length,
    unmatched: result.unmatchedDatabaseRules,
  };
}

export function databaseRuleCases(getPacked: () => Packed): void {
  it('finds something to change for every database rule when a PostgreSQL project has everything on', async () => {
    const { errors, rules, unmatched } = await pruneEverything(getPacked(), 'postgres');

    // More than a hundred rules ran: an empty list is not an empty manifest.
    expect({ errors, ran: rules > 100, unmatched }).toEqual({
      errors: [],
      ran: true,
      unmatched: [],
    });
  });

  it('finds something to change for every database rule when a MongoDB project has everything on', async () => {
    const { errors, rules, unmatched } = await pruneEverything(getPacked(), 'mongodb');

    expect({ errors, ran: rules > 5, unmatched }).toEqual({
      errors: [],
      ran: true,
      unmatched: [],
    });
  });
}
