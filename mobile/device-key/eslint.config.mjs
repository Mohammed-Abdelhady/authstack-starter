import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

const NODE_BUILTIN_IMPORTS = builtinModules.map((specifier) => specifier.replace(/^node:/, ''));

export default tseslint.config(
  { linterOptions: { noInlineConfig: true } },
  {
    ignores: ['dist/**', 'android/**', 'ios/**', 'eslint.config.mjs'],
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
    // The shell hands the native module in. An import here would let this
    // package resolve its own second copy of Expo. The fakes a shell imports
    // stay free of Node too, so they run on a device.
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
        'atob',
        'btoa',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'setImmediate',
        'console',
        'globalThis',
        'performance',
        'window',
        'document',
        'localStorage',
        'navigator',
        'fetch',
      ],
    },
  },
);
