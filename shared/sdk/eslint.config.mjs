import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

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
    // The package ships to browsers, servers and mobile shells: source files
    // must not touch Node, DOM, React, Next or React Native APIs. The injected
    // transport owns all I/O, so `fetch` is out as well.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
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
          paths: ['react', 'react-dom', 'next', 'react-native'],
          patterns: ['node:*', 'next/*'],
        },
      ],
    },
  },
);
