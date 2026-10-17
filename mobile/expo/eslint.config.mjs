import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { linterOptions: { noInlineConfig: true } },
  {
    ignores: ['ios/**', 'android/**', '.expo/**', 'dist/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'vitest.config.mts',
            'metro.config.js',
            'app.config.js',
            'plugins/with-scene-lifecycle.js',
            'plugins/with-google-modules.js', // feature:google
            'test/scene-lifecycle.test.cjs',
            'test/google-modules.test.cjs', // feature:google
          ],
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
    // Metro and Expo prebuild load these with require.
    files: ['metro.config.js', 'app.config.js', 'plugins/*.js', 'test/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
