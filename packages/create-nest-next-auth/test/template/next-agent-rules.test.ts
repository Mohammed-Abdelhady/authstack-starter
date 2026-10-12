import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { REPO_ROOT } from '../support/combination-helpers.js';

it('disables Next dev instruction generation in the shipped frontend config', () => {
  const config = readFileSync(join(REPO_ROOT, 'frontend/next.config.ts'), 'utf8');
  expect(config).toMatch(/^\s*agentRules: false,/m);
});
