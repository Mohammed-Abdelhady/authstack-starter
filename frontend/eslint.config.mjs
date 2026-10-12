import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import { hardcodedStringViolations } from '../scripts/hardcoded-strings-policy.mjs';

const eslintConfig = defineConfig([
  { linterOptions: { noInlineConfig: true } },
  ...nextVitals,
  ...nextTs,
  eslintPluginPrettierRecommended,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.{test,spec}.tsx', 'src/**/__tests__/**', 'src/tests/**'],
    plugins: {
      localization: {
        rules: {
          'catalogue-strings': {
            meta: {
              type: 'problem',
              schema: [],
              messages: { hardcoded: 'User-facing {{kind}} must use the message catalogue.' },
            },
            create(context) {
              return {
                Program() {
                  const violations = hardcodedStringViolations(
                    context.sourceCode.text,
                    context.filename,
                  );
                  for (const { line, kind } of violations) {
                    context.report({
                      loc: { line, column: 0 },
                      messageId: 'hardcoded',
                      data: { kind },
                    });
                  }
                },
              };
            },
          },
        },
      },
    },
    rules: { 'localization/catalogue-strings': 'error' },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
]);

export default eslintConfig;
