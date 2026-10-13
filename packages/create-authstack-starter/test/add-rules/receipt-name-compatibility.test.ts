import { readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { applyRules, planRules } from '../../src/add-rules/plan.js';
import { cleanRulesFixtures, put, rulesFixture, TRUSTED_RULES_ROOT } from './add-rules-fixture.js';

const CURRENT_FILE = '.create-authstack-starter.rules.json';
const LEGACY_FILE = '.create-nest-next-auth.rules.json';
afterEach(cleanRulesFixtures);

async function legacySetup(): Promise<string> {
  const root = await rulesFixture();
  await applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT));
  await rename(join(root, CURRENT_FILE), join(root, LEGACY_FILE));
  return root;
}

it('replays a legacy receipt without migrating or rewriting its project', async () => {
  const root = await legacySetup();
  const before = await readdir(root, { recursive: true });
  const receipt = await readFile(join(root, LEGACY_FILE), 'utf8');
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  expect({ files: plan.files, blockers: plan.blockers }).toEqual({ files: [], blockers: [] });
  await applyRules(plan);
  expect(await readdir(root, { recursive: true })).toEqual(before);
  expect(await readFile(join(root, LEGACY_FILE), 'utf8')).toBe(receipt);
});

it('rejects two receipt names before writing anything', async () => {
  const root = await legacySetup();
  await put(root, CURRENT_FILE, await readFile(join(root, LEGACY_FILE), 'utf8'));
  const before = await readdir(root, { recursive: true });
  await expect(planRules(root, 'strict', TRUSTED_RULES_ROOT)).rejects.toThrow();
  expect(await readdir(root, { recursive: true })).toEqual(before);
});

it('continues blocking edits to a setup recorded by the legacy receipt', async () => {
  const root = await legacySetup();
  await put(root, 'CLAUDE.md', 'owned');
  await expect(applyRules(await planRules(root, 'strict', TRUSTED_RULES_ROOT))).rejects.toThrow();
  expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('owned');
});

it('continues blocking level changes from a legacy receipt', async () => {
  const root = await legacySetup();
  await expect(applyRules(await planRules(root, 'standard', TRUSTED_RULES_ROOT))).rejects.toThrow();
});

it('rejects malformed legacy receipts', async () => {
  const root = await rulesFixture();
  await put(root, LEGACY_FILE, '{');
  await expect(planRules(root, 'strict', TRUSTED_RULES_ROOT)).rejects.toThrow();
});

it('refuses a legacy receipt that appeared after a fresh plan', async () => {
  const root = await rulesFixture();
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await put(root, LEGACY_FILE, '{}');
  await expect(applyRules(plan)).rejects.toThrow();
  expect((await readdir(root)).sort()).toEqual([LEGACY_FILE, 'package.json']);
});

it('refuses a changed legacy receipt after replay inspection', async () => {
  const root = await legacySetup();
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  await put(root, LEGACY_FILE, '{}');
  await expect(applyRules(plan)).rejects.toThrow();
  expect(await readFile(join(root, LEGACY_FILE), 'utf8')).toBe('{}');
});
