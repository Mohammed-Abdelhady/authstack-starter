// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

const NODE_BUILTIN_IMPORTS = builtinModules.map((specifier) => specifier.replace(/^node:/, ''));

export default tseslint.config(
  { linterOptions: { noInlineConfig: true } },
  {
    ignores: ['dist/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.mts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['build-config/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'readonly' } },
  },
  {
    // The shell hands every native module and platform global in. An import
    // here would let this package resolve its own second copy of one.
    files: ['src/**/*.ts', 'test/support/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...NODE_BUILTIN_IMPORTS, 'react', 'react-dom', 'react-native', 'expo'],
          patterns: [
            'node:*',
            'node:*/*',
            '@expo/*',
            'react/*',
            'react-dom/*',
            'react-native/*',
            'expo/*',
            'expo-*',
            'expo-*/*',
            '@react-native*',
            '@react-native*/*',
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        'crypto',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'setImmediate',
        'console',
        'globalThis',
        'performance',
        'AbortSignal',
        'AbortController',
        'window',
        'document',
        'localStorage',
        'navigator',
        'fetch',
        'XMLHttpRequest',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now' },
        { object: 'Math', property: 'random' },
      ],
    },
  },
);
