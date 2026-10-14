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
          allowDefaultProject: ['vitest.config.ts'],
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
    files: ['src/**/*.ts', 'conformance/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        'URL',
        'URLSearchParams',
        'TextEncoder',
        'TextDecoder',
        'btoa',
        'atob',
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
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NODE_BUILTIN_IMPORTS,
            'react',
            'react-dom',
            'next',
            'react-native',
            'expo',
          ],
          patterns: [
            'node:*',
            'node:*/*',
            '@expo/*',
            'next/*',
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
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now' },
        { object: 'Math', property: 'random' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Use the injected clock port instead of constructing the current date.',
        },
      ],
    },
  },
);
