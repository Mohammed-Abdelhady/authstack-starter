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
const MONGO_DRIVERS = ['mongoose', 'mongodb', '@nestjs/mongoose'];
// feature:mongodb:end
// feature:postgres:start
const POSTGRES_ADAPTER = 'src/**/persistence/postgres/**';
const POSTGRES_TEST_SUPPORT = 'test/postgres/**';
const POSTGRES_DRIVERS = ['kysely', 'pg'];
// feature:postgres:end

/** Bans the packages and everything under them, type-only imports included. */
function driverBan(drivers, adapter) {
  const message = `Only ${adapter} may import a database driver. Go through a store port.`;
  const named = drivers.map((name) => name.replaceAll('/', '\\/')).join('|');
  const source = `/^(?:${named})(?:\\/.*)?$/`;
  return {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: drivers.map((name) => ({ name, message })),
        patterns: [{ group: drivers.map((name) => `${name}/*`), message }],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: `CallExpression[callee.name='require'][arguments.0.value=${source}]`,
        message,
      },
      { selector: `ImportExpression[source.value=${source}]`, message },
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
    rules: driverBan(
      [
        ...MONGO_DRIVERS, // feature:mongodb
        ...POSTGRES_DRIVERS, // feature:postgres
      ],
      'a persistence adapter folder',
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
