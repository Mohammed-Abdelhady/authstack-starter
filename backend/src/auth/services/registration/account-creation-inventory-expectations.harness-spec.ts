export type InventoryBoundary = 'parameter' | 'run' | 'runForAuthority';

interface InventoryCaller {
  readonly file: string;
  readonly owner: string;
  readonly method: string;
  readonly boundary: InventoryBoundary;
}

const CALLERS: readonly InventoryCaller[] = [
  {
    file: 'auth/utils/activation.util.ts',
    owner: 'createActivatedAccount',
    method: 'insertActivated',
    boundary: 'parameter',
  },
  // feature:magic-link:start
  {
    file: 'auth/magic-link/magic-link-account-creation.ts',
    owner: 'createUser',
    method: 'createPasswordlessIn',
    boundary: 'run',
  },
  {
    file: 'auth/native/lifecycle/native-email-link-mail.service.ts',
    owner: 'resolveAccountIn',
    method: 'createPasswordlessIn',
    boundary: 'parameter',
  },
  // feature:magic-link:end
  // feature:oauth-core:start
  {
    file: 'auth/oauth/oauth.service.ts',
    owner: 'createUser',
    method: 'createFromProviderIn',
    boundary: 'run',
  },
  // feature:oauth-core:end
  {
    file: 'admin/services/users/admin-user-create.service.ts',
    owner: 'createUser',
    method: 'insertAccount',
    boundary: 'runForAuthority',
  },
  {
    file: 'database/seeds/seed.service.ts',
    owner: 'seedUsers',
    method: 'createAccount',
    boundary: 'run',
  },
];

const RAW_INSERTS = [
  // feature:postgres:start
  [
    'auth/persistence/postgres/postgres-activation-accounts.ts',
    'insertActivated',
    'postgres',
  ],
  // feature:postgres:end
  // feature:mongodb:start
  [
    'auth/persistence/mongo/mongo-activation-accounts.ts',
    'insertActivated',
    'construct',
  ],
  [
    'auth/persistence/mongo/mongo-activation-accounts.ts',
    'insertActivated',
    'save',
  ],
  // feature:mongodb:end
  // feature:magic-link:start
  // feature:postgres:start
  [
    'auth/magic-link/persistence/postgres/postgres-magic-link.store.ts',
    'createPasswordlessIn',
    'postgres',
  ],
  // feature:postgres:end
  // feature:mongodb:start
  [
    'auth/magic-link/persistence/mongo/mongo-magic-link-accounts.ts',
    'createPasswordlessIn',
    'create',
  ],
  // feature:mongodb:end
  // feature:magic-link:end
  // feature:oauth-core:start
  // feature:postgres:start
  [
    'auth/oauth/persistence/postgres/postgres-provider-sign-in.store.ts',
    'createFromProviderIn',
    'postgres',
  ],
  // feature:postgres:end
  // feature:mongodb:start
  [
    'auth/oauth/persistence/mongo/mongo-provider-sign-in.store.ts',
    'createFromProviderIn',
    'create',
  ],
  // feature:mongodb:end
  // feature:oauth-core:end
  // feature:postgres:start
  [
    'admin/persistence/postgres/postgres-admin-account.store.ts',
    'insertAccount',
    'postgres',
  ],
  [
    'database/seeds/persistence/postgres/postgres-seed.store.ts',
    'createAccount',
    'postgres',
  ],
  // feature:postgres:end
  // feature:mongodb:start
  [
    'admin/persistence/mongo/mongo-admin-account.store.ts',
    'insertAccount',
    'construct',
  ],
  [
    'admin/persistence/mongo/mongo-admin-account.store.ts',
    'insertAccount',
    'save',
  ],
  [
    'database/seeds/persistence/mongo/mongo-seed.store.ts',
    'createAccount',
    'create',
  ],
  // feature:mongodb:end
] as const;

// Deployment seeds bootstrap a deployment rather than accepting a sign-up.
export const SEED_BOOTSTRAP_EXEMPTION =
  'database/seeds/seed.service.ts#seedUsers#createAccount';

export const ACCOUNT_INSERT_METHODS = new Set([
  'insertActivated',
  'createPasswordlessIn',
  'createFromProviderIn',
  'insertAccount',
  'createAccount',
]);

export const callerKey = (file: string, owner: string, method: string) =>
  `${file}#${owner}#${method}`;

export function expectedInventory(files: ReadonlySet<string>) {
  const paths = [...files];
  const storageDirectory = (file: string) =>
    /\/persistence\/([^/]+)\//.exec(file)?.[1];
  const presentDatabases = new Set(
    paths.flatMap((file) => {
      const directory = storageDirectory(file);
      return directory ? [directory] : [];
    }),
  );
  const present = (file: string) => {
    if (
      (file.startsWith('auth/magic-link/') ||
        file.includes('native-email-link-')) &&
      !paths.some((path) => path.startsWith('auth/magic-link/'))
    ) {
      return false;
    }
    if (
      file.startsWith('auth/oauth/') &&
      !paths.some((path) => path.startsWith('auth/oauth/'))
    ) {
      return false;
    }
    const database = storageDirectory(file);
    return database === undefined || presentDatabases.has(database);
  };
  return {
    callers: CALLERS.filter((entry) => present(entry.file)),
    raw: RAW_INSERTS.filter(([file]) => present(file)).map(
      ([file, owner, kind]) => callerKey(file, owner, kind),
    ),
  };
}
