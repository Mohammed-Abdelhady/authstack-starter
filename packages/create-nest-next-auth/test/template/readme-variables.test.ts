import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../support/combination-helpers.js';

const TABLE_HEADING = '### Key backend variables';
const VARIABLE_CELL = /^\| `([A-Z][A-Z0-9_]*)`/;

/** The variables the README's backend table names, in order. */
function documentedVariables(readme: string): string[] {
  const table = readme.slice(readme.indexOf(TABLE_HEADING)).split('\n### ')[0];
  return table.split('\n').flatMap((line) => VARIABLE_CELL.exec(line)?.[1] ?? []);
}

describe('the backend variables the README documents', () => {
  it('are all variables the example file sets or shows commented out', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const example = readFileSync(join(REPO_ROOT, 'backend/.env.example'), 'utf8');
    const documented = documentedVariables(readme);

    expect(documented).toContain('CLIENT_URL');
    expect(documented.filter((name) => !new RegExp(`^(?:# )?${name}=`, 'm').test(example))).toEqual(
      [],
    );
  });
});
