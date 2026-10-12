// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * A database driver is the adapter's business. Everything else reaches the
 * store through a port, so the server can run on either database.
 */
// feature:mongodb:start
const MONGO_ADAPTER = 'src/**/persistence/mongo/**';
const MONGO_ADAPTER_FOLDER = 'mongo';
const MONGO_DRIVERS = ['mongoose', 'mongodb', '@nestjs/mongoose'];
// feature:mongodb:end
// feature:postgres:start
const POSTGRES_ADAPTER = 'src/**/persistence/postgres/**';
const POSTGRES_ADAPTER_FOLDER = 'postgres';
const POSTGRES_TEST_SUPPORT = 'test/postgres/**';
const POSTGRES_DRIVERS = ['kysely', 'pg'];
// feature:postgres:end

const EVERY_DRIVER = [
  ...MONGO_DRIVERS, // feature:mongodb
  ...POSTGRES_DRIVERS, // feature:postgres
];

/**
 * An adapter's files are reached through the one file of a module that hands
 * it the adapter, `persistence/*-persistence.ts`. A spec may still build the
 * adapter it runs on.
 */
const ADAPTER_WIRING = 'src/**/persistence/*-persistence.ts';
const SPECS = ['src/**/*.spec.ts', 'src/**/*.harness-spec.ts'];
/** Files that sit beside the adapter folders and name them by a short path. */
const BESIDE_ADAPTERS = 'src/**/persistence/*.ts';
const ADAPTER_FOLDERS = [
  MONGO_ADAPTER_FOLDER, // feature:mongodb
  POSTGRES_ADAPTER_FOLDER, // feature:postgres
];
const ADAPTER_FILE_MESSAGE =
  'Only a persistence/*-persistence.ts wiring file may import an adapter file. Go through a store port.';

/** Reports a `require` call and an `import()` whose source matches. */
function loadBan(source, message) {
  return [
    {
      selector: `CallExpression[callee.name='require'][arguments.0.value=${source}]`,
      message,
    },
    { selector: `ImportExpression[source.value=${source}]`, message },
  ];
}

/**
 * Bans every way of naming a file inside an adapter folder. `prefixes` are the
 * forms a path to `persistence/` takes from where the importing file sits.
 */
function adapterFileBan(prefixes) {
  const folders = ADAPTER_FOLDERS.join('|');
  const starts = prefixes.map((prefix) => prefix.source).join('|');
  const source = `/^(?:${starts})(?:${folders})(?:\\/.*)?$/`;
  return {
    pattern: {
      regex: `^(?:${starts})(?:${folders})(?:/.*)?$`,
      message: ADAPTER_FILE_MESSAGE,
    },
    loads: loadBan(source, ADAPTER_FILE_MESSAGE),
  };
}

/** Any path that goes through a `persistence` folder into an adapter folder. */
const THROUGH_PERSISTENCE = /(?:.*\/)?persistence\//;
/** The same folders from a file that sits beside them. */
const FROM_BESIDE = /\.\//;

/**
 * Bans the packages and everything under them, type-only imports included.
 * With `adapterFiles`, also bans the files of the adapter folders.
 */
function driverBan(drivers, adapter, adapterFiles) {
  const message = `Only ${adapter} may import a database driver. Go through a store port.`;
  const named = drivers.map((name) => name.replaceAll('/', '\\/')).join('|');
  const source = `/^(?:${named})(?:\\/.*)?$/`;
  return {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: drivers.map((name) => ({ name, message })),
        patterns: [
          { group: drivers.map((name) => `${name}/*`), message },
          ...(adapterFiles ? [adapterFiles.pattern] : []),
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      ...loadBan(source, message),
      ...(adapterFiles ? adapterFiles.loads : []),
    ],
  };
}

export default tseslint.config(
  { linterOptions: { noInlineConfig: true } },
  {
    ignores: ['eslint.config.mjs', 'dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      MONGO_ADAPTER, // feature:mongodb
      POSTGRES_ADAPTER, // feature:postgres
    ],
    rules: driverBan(EVERY_DRIVER, 'a persistence adapter folder'),
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      MONGO_ADAPTER, // feature:mongodb
      POSTGRES_ADAPTER, // feature:postgres
      ADAPTER_WIRING,
      ...SPECS,
    ],
    rules: driverBan(
      EVERY_DRIVER,
      'a persistence adapter folder',
      adapterFileBan([THROUGH_PERSISTENCE]),
    ),
  },
  {
    files: [BESIDE_ADAPTERS],
    ignores: [ADAPTER_WIRING, ...SPECS],
    rules: driverBan(
      EVERY_DRIVER,
      'a persistence adapter folder',
      adapterFileBan([THROUGH_PERSISTENCE, FROM_BESIDE]),
    ),
  },
  // feature:database-choice:start
  {
    files: [MONGO_ADAPTER],
    rules: driverBan(POSTGRES_DRIVERS, 'the PostgreSQL adapter'),
  },
  {
    files: [POSTGRES_ADAPTER],
    rules: driverBan(MONGO_DRIVERS, 'the MongoDB adapter'),
  },
  // feature:database-choice:end
  // feature:postgres:start
  {
    // feature:database-choice:start
    // Test support may hold a MongoDB connection of its own. PostgreSQL has one
    // home there, the PostgreSQL test folder.
    // feature:database-choice:end
    files: ['test/**/*.ts'],
    ignores: [POSTGRES_TEST_SUPPORT],
    rules: driverBan(POSTGRES_DRIVERS, 'the PostgreSQL adapter'),
  },
  // feature:postgres:end
);
