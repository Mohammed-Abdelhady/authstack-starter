import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = 'shared/core/scripts/auth-access.mjs';
const OUTPUT = 'shared/core/src/host-access.ts';
const ORIGINAL = 'export const retained = true;\n';
function isolatedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'auth-access-boundary-'));
  mkdirSync(join(root, 'shared/core/src'), { recursive: true });
  writeFileSync(join(root, OUTPUT), ORIGINAL);
  const scripts = join(ROOT, 'shared/core/scripts');
  if (existsSync(scripts)) cpSync(scripts, join(root, 'shared/core/scripts'), { recursive: true });
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [join(root, SCRIPT), ...args], {
    cwd: root,
    env: isolatedEnv(),
    encoding: 'utf8',
  });
}

test('unknown arguments refuse before changing the client catalogue', () => {
  const root = fixture();
  try {
    const result = run(root, ['--replace-everything']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown argument/u);
    assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('a core-only checkout reports the absent backend without changing its catalogue', () => {
  const root = fixture();
  try {
    const result = run(root, ['--check']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Backend source is missing; run auth:access in the API checkout/u);
    assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
  } finally {
    rmSync(root, { recursive: true });
  }
});

async function sync(root, check = false) {
  const { syncHostAccess } = await import('../../../shared/core/scripts/auth-access/sync.mjs');
  const { runtime } = await import('./host-access-fixtures.mjs');
  return syncHostAccess({ root, check, tools: runtime() });
}

test('the actual host catalogue and copied type contract are current in the root gate', async () => {
  assert.deepEqual(await sync(ROOT, true), { changed: false });
});

const CUSTOM_SOURCE = `
import { ROLE_AUDIENCE } from './types/host-role.type';
import { PERMISSIONS } from './permissions';
export const HOST_PERMISSIONS = [PERMISSIONS[1], PERMISSIONS[0], PERMISSIONS[1]];
export const HOST_ROLES = [
  {name: "Chef's team", slug: 'chef', level: 3, audience: ROLE_AUDIENCE.STAFF,
   permissions: [PERMISSIONS[1], PERMISSIONS[0]], description: 'طبخ\\nA \\"quote\\"'},
  {name: 'Customer', slug: 'customer', level: 1, audience: ROLE_AUDIENCE.CUSTOMER,
   permissions: [], description: ''},
];
`;
const EMPTY_SOURCE = 'export const HOST_PERMISSIONS = []; export const HOST_ROLES = [];';

test('trusted host exports cross the generated writer and real client module in their original order', async () => {
  const { hostFixture, readClient } = await import('./host-access-fixtures.mjs');
  const root = hostFixture(CUSTOM_SOURCE);
  writeFileSync(
    join(root, 'backend/src/host/permissions.ts'),
    "export const PERMISSIONS = ['custom:read:own', 'custom:edit:staff'];\n",
  );
  try {
    await sync(root);
    rmSync(join(root, 'backend'), { recursive: true });
    assert.deepEqual(readClient(root), {
      ROLE_AUDIENCE: { CUSTOMER: 'customer', STAFF: 'staff' },
      HOST_PERMISSIONS: ['custom:edit:staff', 'custom:read:own', 'custom:edit:staff'],
      HOST_ROLES: [
        {
          name: "Chef's team",
          slug: 'chef',
          level: 3,
          audience: 'staff',
          permissions: ['custom:edit:staff', 'custom:read:own'],
          description: 'طبخ\nA "quote"',
        },
        {
          name: 'Customer',
          slug: 'customer',
          level: 1,
          audience: 'customer',
          permissions: [],
          description: '',
        },
      ],
    });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('empty exports write deterministically and current check and no-op write preserve the file', async () => {
  const { hostFixture, readClient } = await import('./host-access-fixtures.mjs');
  const { statSync } = await import('node:fs');
  const root = hostFixture(EMPTY_SOURCE);
  try {
    await assert.rejects(sync(root, true), /stale/u);
    assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
    await sync(root);
    const before = statSync(join(root, OUTPUT), { bigint: true });
    const content = readFileSync(join(root, OUTPUT), 'utf8');
    await sync(root, true);
    await sync(root);
    const after = statSync(join(root, OUTPUT), { bigint: true });
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), content);
    assert.deepEqual(readClient(root), {
      ROLE_AUDIENCE: { CUSTOMER: 'customer', STAFF: 'staff' },
      HOST_PERMISSIONS: [],
      HOST_ROLES: [],
    });
  } finally {
    rmSync(root, { recursive: true });
  }
});

for (const [failure, access, message] of [
  ['missing export', 'export const HOST_PERMISSIONS = [];', /HOST_ROLES/u],
  [
    'wrong export shape',
    'export const HOST_PERMISSIONS = 2; export const HOST_ROLES = [];',
    /arrays/u,
  ],
  [
    'unserializable export',
    'export const HOST_PERMISSIONS = [() => 1]; export const HOST_ROLES = [];',
    /unserializable/u,
  ],
  [
    'wrong role type',
    'export const HOST_PERMISSIONS = []; export const HOST_ROLES = [{name:"Incomplete"}];',
    /type validation/u,
  ],
  [
    'source failure',
    `${EMPTY_SOURCE}\nthrow new Error('Host module refused');`,
    /Host module refused/u,
  ],
]) {
  test(`${failure} refuses before overwriting the existing catalogue`, async () => {
    const { hostFixture } = await import('./host-access-fixtures.mjs');
    const root = hostFixture(access);
    try {
      await assert.rejects(sync(root), message);
      assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
}

for (const contract of [
  "import type { Other } from './other';\n",
  "export * from './other';\n",
  'export const ROLE_AUDIENCE = {};',
]) {
  test('dependent or incomplete type contracts cannot replace the client catalogue', async () => {
    const { hostFixture } = await import('./host-access-fixtures.mjs');
    const root = hostFixture(EMPTY_SOURCE);
    try {
      const path = join(root, 'backend/src/host/types/host-role.type.ts');
      writeFileSync(path, contract);
      await assert.rejects(sync(root), /self-contained/u);
      assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
}

test('a failed atomic rename leaves the original intact and removes its owned temporary file', async () => {
  const { writeCatalogue } = await import('../../../shared/core/scripts/auth-access/sync.mjs');
  const { readdirSync } = await import('node:fs');
  const { open } = await import('node:fs/promises');
  const root = fixture();
  let ownedHandle;
  try {
    await assert.rejects(
      writeCatalogue(join(root, OUTPUT), 'replacement', {
        create: async (...args) => {
          ownedHandle = await open(...args);
          return ownedHandle;
        },
        move: async () => {
          throw new Error('rename refused');
        },
      }),
      /rename refused/u,
    );
    await assert.rejects(ownedHandle.stat(), { code: 'EBADF' });
    assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
    assert.deepEqual(readdirSync(join(root, 'shared/core/src')), ['host-access.ts']);
  } finally {
    await ownedHandle?.close();
    rmSync(root, { recursive: true });
  }
});

test('an output symlink cannot overwrite its destination', async () => {
  const { hostFixture } = await import('./host-access-fixtures.mjs');
  const { symlinkSync } = await import('node:fs');
  const root = hostFixture(EMPTY_SOURCE);
  const other = join(root, 'other.ts');
  try {
    writeFileSync(other, ORIGINAL);
    rmSync(join(root, OUTPUT));
    symlinkSync(other, join(root, OUTPUT));
    await assert.rejects(sync(root));
    assert.equal(readFileSync(other, 'utf8'), ORIGINAL);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('a resolvable imported role type is refused rather than copied as a client dependency', async () => {
  const { hostFixture } = await import('./host-access-fixtures.mjs');
  const root = hostFixture(EMPTY_SOURCE);
  try {
    const path = join(root, 'backend/src/host/types/host-role.type.ts');
    const contract = readFileSync(path, 'utf8').replace(
      'description: string;',
      'description: Extra;',
    );
    writeFileSync(path, `import type { Extra } from './extra';\n${contract}`);
    writeFileSync(join(root, 'backend/src/host/types/extra.ts'), 'export type Extra = string;');
    writeFileSync(join(root, 'shared/core/src/extra.ts'), 'export type Extra = string;');
    await assert.rejects(sync(root));
    assert.equal(readFileSync(join(root, OUTPUT), 'utf8'), ORIGINAL);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('a symlink in output ancestry cannot redirect the write', async () => {
  const { hostFixture } = await import('./host-access-fixtures.mjs');
  const { renameSync, symlinkSync } = await import('node:fs');
  const root = hostFixture(EMPTY_SOURCE);
  const redirected = join(root, 'other-source');
  try {
    renameSync(join(root, 'shared/core/src'), redirected);
    symlinkSync(redirected, join(root, 'shared/core/src'));
    await assert.rejects(sync(root));
    assert.equal(readFileSync(join(redirected, 'host-access.ts'), 'utf8'), ORIGINAL);
  } finally {
    rmSync(root, { recursive: true });
  }
});
