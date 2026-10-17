import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { backendPaths } from '../../../shared/core/scripts/auth-access/backend.mjs';
import { loadBackendTools } from '../../../backend/scripts/host-access-tools.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const OUTPUT = 'shared/core/src/host-access.ts';
export const ORIGINAL = 'export const retained = true;\n';
const CONTRACT = 'backend/src/host/types/host-role.type.ts';
let tools;

export function runtime() {
  tools ??= loadBackendTools(backendPaths(ROOT));
  return tools;
}

export function hostFixture(access) {
  const root = mkdtempSync(join(tmpdir(), 'auth-access-writing-'));
  mkdirSync(join(root, 'backend/src/host/types'), { recursive: true });
  mkdirSync(join(root, 'backend/scripts'));
  mkdirSync(join(root, 'shared/core/src'), { recursive: true });
  writeFileSync(join(root, 'backend/package.json'), '{"type":"commonjs"}\n');
  writeFileSync(join(root, 'backend/tsconfig.json'), '{"compilerOptions":{"module":"commonjs"}}\n');
  cpSync(join(ROOT, CONTRACT), join(root, CONTRACT));
  writeFileSync(join(root, OUTPUT), ORIGINAL);
  writeFileSync(join(root, 'backend/src/host/access.ts'), access);
  return root;
}

export function readClient(root) {
  const ts = runtime().ts;
  const source = readFileSync(join(root, OUTPUT), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const output = join(root, 'client.cjs');
  writeFileSync(output, compiled.outputText);
  return createRequire(output)(output);
}
