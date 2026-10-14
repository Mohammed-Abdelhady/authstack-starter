import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
// feature:mongodb:start
import {
  MONGO_RAW_INSERT_FIXTURES,
  MONGO_UNFOLLOWED_RAW_FIXTURES,
} from './persistence/mongo/account-creation-inventory-mongo-fixtures.harness-spec';
// feature:mongodb:end
// feature:postgres:start
import {
  POSTGRES_RAW_INSERT_FIXTURES,
  POSTGRES_UNFOLLOWED_RAW_FIXTURES,
} from './persistence/postgres/account-creation-inventory-postgres-fixtures.harness-spec';
// feature:postgres:end

const SOURCE_ROOT = join(__dirname, '../../..');
const FEATURE_OWNERSHIP = {
  'magic-link': [
    'auth/magic-link/',
    'auth/native/lifecycle/native-email-link',
    'auth/native/lifecycle/dto/native-email-link-',
  ],
  'email-password': [
    'auth/native/factors/native-password.service.ts',
    'auth/native/lifecycle/native-registration.',
    'auth/native/lifecycle/native-recovery.',
  ],
  'oauth-core': [
    'auth/oauth/',
    'auth/native/providers/',
    'user/user-providers.controller.ts',
    'user/stores/linked-account.store.ts',
    'user/persistence/mongo/mongo-linked-account.', // feature:mongodb
    'user/persistence/mongo/mongo-linked-account-stores.ts', // feature:mongodb
    'user/persistence/postgres/postgres-linked-account.store.ts', // feature:postgres
    'user/services/account-linking.',
    'user/services/profile-sync.service.ts',
    'user/dto/account-linking.dto.ts',
  ],
} as const;

export function readInventoryDocuments() {
  const documents = new Map<string, string>();
  const readDirectory = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        readDirectory(path);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.harness-spec.ts')
      ) {
        documents.set(relative(SOURCE_ROOT, path), readFileSync(path, 'utf8'));
      }
    }
  };
  readDirectory(SOURCE_ROOT);
  return documents;
}

export function stripRemovedMarkers(
  text: string,
  removed: ReadonlySet<string>,
) {
  const stack: boolean[] = [];
  const output: string[] = [];
  for (const line of text.split('\n')) {
    const marker = /\/\/ feature:([a-z0-9,-]+)(?::(start|end))?\s*$/.exec(line);
    const ids = marker?.[1].split(',');
    const drop = ids?.every((id) => removed.has(id)) ?? false;
    if (marker?.[2] === 'start') {
      stack.push(drop);
      continue;
    }
    if (marker?.[2] === 'end') {
      if (stack.pop() === undefined)
        throw new Error('Unmatched feature marker');
      continue;
    }
    if (stack.some(Boolean) || drop) continue;
    output.push(marker ? line.slice(0, marker.index).trimEnd() : line);
  }
  if (stack.length > 0) throw new Error('Unclosed feature marker');
  return output.join('\n');
}

export function withoutInventoryFeatures(
  documents: ReadonlyMap<string, string>,
  features: readonly (keyof typeof FEATURE_OWNERSHIP)[],
) {
  const removed = new Set<string>(features);
  const owned = features.flatMap((feature) => [...FEATURE_OWNERSHIP[feature]]);
  return new Map(
    [...documents]
      .filter(([file]) => !owned.some((path) => file.startsWith(path)))
      .map(([file, text]) => [file, stripRemovedMarkers(text, removed)]),
  );
}

export function appendInventoryFixture(
  documents: ReadonlyMap<string, string>,
  source: string,
) {
  const mutated = new Map(documents);
  mutated.set('auth/services/registration/ungated-fixture.ts', source);
  return mutated;
}

export const UNFOLLOWED_INSERT_FIXTURES = [
  ['bound method', 'store.insertActivated.bind(store)'],
  ['method call', 'store.insertActivated.call(store, work, {})'],
  ['method apply', 'store.insertActivated.apply(store, [work, {}])'],
  ['assigned method', 'const insert = store.insertActivated'],
  ['passed method', 'consume(store.insertActivated)'],
  ['destructured method', 'const { insertActivated: insert } = store'],
  ['shorthand destructured method', 'const { insertActivated } = store'],
  ['literal element method', "store['insertActivated'].bind(store)"],
  [
    'computed element method',
    "const m = 'insertActivated'; const insert = store[m]",
  ],
  [
    'computed constant assertion method',
    "const m = 'insertActivated' as const; consume(store[m])",
  ],
  [
    'computed destructured method',
    "const m = 'insertActivated'; const { [m]: insert } = store",
  ],
] as const;

export const UNFOLLOWED_RAW_FIXTURES = [
  ...[
    "store['insertActivated'](work, {})",
    "const m = 'insertActivated'; store[m](work, {})",
    "const m = 'insertActivated' as const; store[m](work, {})",
  ].map((source) => ({
    kind: `uninventoried direct element insert: ${source}`,
    source,
    diagnostic: 'callers: expected',
  })),
  {
    kind: 'unresolved computed method',
    source: 'store[methodName()](work, {})',
    diagnostic: 'unresolved computed method may insert an account',
  },
  ...[
    "function other() { const m = 'noop'; }",
    'function other(m) { return m; }',
    "function other() { let m = 'noop'; }",
  ].map((shadow) => ({
    kind: `shadowed insert method: ${shadow}`,
    source: `const m = 'insertActivated'; ${shadow} store[m](work, {})`,
    diagnostic: 'unresolved computed method may insert an account',
  })),
  ...MONGO_UNFOLLOWED_RAW_FIXTURES, // feature:mongodb
  ...POSTGRES_UNFOLLOWED_RAW_FIXTURES, // feature:postgres
] as const;

export const RAW_INSERT_FIXTURES = [
  ...MONGO_RAW_INSERT_FIXTURES, // feature:mongodb
  ...POSTGRES_RAW_INSERT_FIXTURES, // feature:postgres
] as const;
