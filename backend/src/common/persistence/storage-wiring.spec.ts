import { Provider } from '@nestjs/common';
import { forgetStorageChoice } from './storage-choice';

/**
 * The files that name a database, and what each hands its module. Every one
 * is loaded twice, once per setting, the way a starting server loads it.
 */
const NEUTRAL_FILES: Array<{ file: string; providers: string }> = [
  {
    file: '../../admin/persistence/admin-persistence',
    providers: 'ADMIN_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../auth/magic-link/persistence/magic-link-persistence',
    providers: 'MAGIC_LINK_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../auth/oauth/persistence/oauth-persistence',
    providers: 'OAUTH_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../auth/passkeys/persistence/passkeys-persistence',
    providers: 'PASSKEYS_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../auth/persistence/auth-persistence',
    providers: 'AUTH_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../auth/two-factor/persistence/two-factor-persistence',
    providers: 'TWO_FACTOR_PERSISTENCE_PROVIDERS',
  },
  { file: './common-persistence', providers: 'COMMON_PERSISTENCE_PROVIDERS' },
  {
    file: '../../database/seeds/persistence/seed-persistence',
    providers: 'SEED_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../health/persistence/health-persistence',
    providers: 'HEALTH_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../role/persistence/role-persistence',
    providers: 'ROLE_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../session/native/persistence/native-oauth-persistence',
    providers: 'NATIVE_OAUTH_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../session/persistence/session-persistence',
    providers: 'SESSION_PERSISTENCE_PROVIDERS',
  },
  {
    file: '../../user/persistence/user-persistence',
    providers: 'USER_PERSISTENCE_PROVIDERS',
  },
];

function nameOf(token: unknown): string {
  if (typeof token === 'function') return token.name;
  return typeof token === 'symbol' ? token.toString() : String(token);
}

/** The ports a provider list binds: abstract classes bound to something else. */
function portsOf(providers: Provider[]): string[] {
  return (
    providers
      .filter(
        (
          provider,
        ): provider is Exclude<Provider, new (...args: never[]) => unknown> =>
          typeof provider !== 'function',
      )
      // A port is a class. A symbol names a connection an adapter keeps to itself.
      .filter((provider) => typeof provider.provide === 'function')
      .map((provider) => nameOf(provider.provide))
      .filter(
        (name) => !name.startsWith('Postgres') && !name.startsWith('Mongo'),
      )
      .sort()
  );
}

/** What the adapter classes behind a list are called, to tell whose they are. */
function adapterNamesOf(providers: Provider[]): string[] {
  return providers.flatMap((provider) => {
    if (typeof provider === 'function') return [provider.name];
    if ('useClass' in provider) return [provider.useClass.name];
    return [];
  });
}

function loadUnder(kind: string | undefined): Record<string, Provider[]> {
  const loaded: Record<string, Provider[]> = {};
  jest.isolateModules(() => {
    if (kind === undefined) delete process.env.DATABASE_TYPE;
    else process.env.DATABASE_TYPE = kind;
    for (const { file, providers } of NEUTRAL_FILES) {
      // A module file picks its adapter when it is loaded, so it is loaded here.
      const exported: unknown = jest.requireActual(file);
      loaded[providers] = Reflect.get(
        Object(exported),
        providers,
      ) as Provider[];
    }
  });
  return loaded;
}

describe('what the neutral persistence files hand their modules', () => {
  const environment = { ...process.env };

  afterEach(() => {
    process.env = { ...environment };
    forgetStorageChoice();
  });

  it('binds on PostgreSQL every port it binds on MongoDB, module by module', () => {
    const mongo = loadUnder('mongodb');
    const postgres = loadUnder('postgres');

    const missing = NEUTRAL_FILES.flatMap(({ providers }) => {
      const bound = new Set(portsOf(postgres[providers]));
      return portsOf(mongo[providers])
        .filter((port) => !bound.has(port))
        .map((port) => `${providers}: ${port}`);
    });

    expect({
      missing,
      ports: NEUTRAL_FILES.reduce(
        (total, { providers }) => total + portsOf(mongo[providers]).length,
        0,
      ),
    }).toEqual({ missing: [], ports: 46 });
  });

  it('binds nothing on PostgreSQL that MongoDB does not bind', () => {
    const mongo = loadUnder('mongodb');
    const postgres = loadUnder('postgres');

    const extra = NEUTRAL_FILES.flatMap(({ providers }) => {
      const bound = new Set(portsOf(mongo[providers]));
      return portsOf(postgres[providers])
        .filter((port) => !bound.has(port))
        .map((port) => `${providers}: ${port}`);
    });

    expect(extra).toEqual([]);
  });

  it('hands out no adapter of the other database', () => {
    const byDefault = loadUnder(undefined);
    const postgres = loadUnder('postgres');
    const named = (lists: Record<string, Provider[]>, prefix: string) =>
      Object.values(lists)
        .flatMap(adapterNamesOf)
        .filter((name) => name.startsWith(prefix));

    expect({
      postgresOnDefault: named(byDefault, 'Postgres'),
      mongoOnPostgres: named(postgres, 'Mongo'),
      mongoOnDefault: named(byDefault, 'Mongo').length > 0,
      postgresOnPostgres: named(postgres, 'Postgres').length > 0,
    }).toEqual({
      postgresOnDefault: [],
      mongoOnPostgres: [],
      mongoOnDefault: true,
      postgresOnPostgres: true,
    });
  });
});
