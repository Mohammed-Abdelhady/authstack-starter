// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

const NODE_BUILTIN_IMPORTS = builtinModules.map((specifier) => specifier.replace(/^node:/, ''));

/** Both shells must be able to host this package, so nothing here may belong to one of them. */
const PLATFORM_IMPORTS = {
  paths: [...NODE_BUILTIN_IMPORTS, 'expo', 'react-dom'],
  patterns: [
    'node:*',
    'node:*/*',
    'expo/*',
    'expo-*',
    'expo-*/*',
    '@expo/*',
    'react-dom/*',
    'react-native-*',
    'react-native-*/*',
    '@react-native*',
    '@react-native*/*',
    '@react-navigation/*',
  ],
};

const TOKENS_MESSAGE = 'Take this value from src/theme/tokens.ts.';
const TYPE_MESSAGE =
  'Text styles come from the type roles. Use Heading, Description, Body or Label from components/Typography.';
const DIRECTION_MESSAGE = 'Use the start and end form so the layout mirrors right to left.';

const LITERAL_VALUES = [
  { selector: 'Literal[value=/^(#[0-9a-fA-F]{3,8}$|rgba?\\(|hsla?\\()/]', message: TOKENS_MESSAGE },
  {
    selector:
      'CallExpression[callee.object.name="StyleSheet"] Property[key.name!=/^flex(Grow|Shrink)?$/] > Literal[raw=/^[0-9]/]',
    message: TOKENS_MESSAGE,
  },
];
const TEXT_STYLES = [
  {
    selector:
      'Property[key.name=/^(fontSize|fontWeight|fontFamily|fontStyle|lineHeight|letterSpacing|color)$/]',
    message: TYPE_MESSAGE,
  },
];
const PHYSICAL_SIDES = [
  {
    selector:
      'Property[key.name=/^(left|right|(margin|padding)(Left|Right)|border(Left|Right)(Width|Color)|border(Top|Bottom)(Left|Right)Radius)$/]',
    message: DIRECTION_MESSAGE,
  },
  {
    selector: 'Property[key.name="textAlign"] > Literal[value=/^(left|right)$/]',
    message: DIRECTION_MESSAGE,
  },
];

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
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', PLATFORM_IMPORTS],
      'no-restricted-syntax': ['error', ...LITERAL_VALUES, ...TEXT_STYLES, ...PHYSICAL_SIDES],
    },
  },
  {
    // The one module that turns the type roles into text styles.
    files: ['src/components/Typography.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...LITERAL_VALUES, ...PHYSICAL_SIDES] },
  },
  {
    files: ['src/theme/tokens.ts'],
    rules: { 'no-restricted-syntax': ['error', ...PHYSICAL_SIDES] },
  },
  {
    // Decisions and state stay free of the renderer, so they run in a plain test process.
    files: ['src/{logic,state,i18n,constants,types,theme}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...PLATFORM_IMPORTS.paths, 'react-native'],
          patterns: [...PLATFORM_IMPORTS.patterns, 'react-native/*'],
        },
      ],
    },
  },
);
