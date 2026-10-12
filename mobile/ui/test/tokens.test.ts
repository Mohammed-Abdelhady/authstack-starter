/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PALETTE, SIZE, type Palette } from '../src/theme/tokens';
import { contrastRatio } from './support/contrast';

type Pair = readonly [foreground: keyof Palette, background: keyof Palette, minimum: number];

const BODY_TEXT = 7;
const SMALL_TEXT = 4.5;
const SHAPE = 3;
/** WCAG 2.5.5 asks for 44 points. */
const SMALLEST_TARGET = 44;

const PAIRS: readonly Pair[] = [
  ['text', 'background', BODY_TEXT],
  ['text', 'surface', BODY_TEXT],
  ['textMuted', 'background', SMALL_TEXT],
  ['textMuted', 'surface', SMALL_TEXT],
  ['onAccent', 'accent', SMALL_TEXT],
  ['danger', 'surface', SMALL_TEXT],
  ['danger', 'background', SMALL_TEXT],
  ['border', 'surface', SHAPE],
  ['border', 'background', SHAPE],
  ['accent', 'background', SHAPE],
  ['accent', 'surface', SHAPE],
  ['focus', 'background', SHAPE],
];

describe.each(['light', 'dark'] as const)('the %s palette', (scheme) => {
  it('keeps every text and shape pairing readable', () => {
    const colors = PALETTE[scheme];
    const tooFaint = PAIRS.filter(
      ([foreground, background, minimum]) =>
        contrastRatio(colors[foreground], colors[background]) < minimum,
    ).map(([foreground, background]) => `${foreground} on ${background}`);

    expect(tooFaint).toEqual([]);
  });
});

it('measures contrast the way WCAG does', () => {
  expect([
    contrastRatio('#000000', '#FFFFFF'),
    Number(contrastRatio('#777777', '#FFFFFF').toFixed(2)),
  ]).toEqual([21, 4.48]);
});

it('makes every pressable at least 44 points', () => {
  expect(SIZE.TARGET_MIN).toBeGreaterThanOrEqual(SMALLEST_TARGET);
});

describe('screens take their text styles from the type roles', () => {
  const SCREENS = fileURLToPath(new URL('../src/screens/', import.meta.url));
  const OWN_TEXT_STYLE = /\b(fontSize|fontWeight|fontFamily|lineHeight|letterSpacing|color)\s*:/;
  const BARE_TEXT = /<Text[\s>]|\bText\b[^;]*from 'react-native'/;
  const sources = readdirSync(SCREENS)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, source: readFileSync(join(SCREENS, file), 'utf8') }));

  it('finds the account and sign-in screens', () => {
    expect(sources.map(({ file }) => file).sort()).toEqual([
      'AccountScreen.tsx',
      'NativeCodeScreen.tsx',
      'NativeConsentScreen.tsx',
      'NativeCredentialScreen.tsx',
      'NativeSecondFactorScreen.tsx',
      'SessionsScreen.tsx',
      'SignInScreen.tsx',
    ]);
  });

  it('lets no screen set a font size, weight, line height or text colour', () => {
    const offenders = sources
      .filter(({ source }) => OWN_TEXT_STYLE.test(source) || BARE_TEXT.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('has every screen title and section heading go through Heading', () => {
    const withoutHeading = sources
      .filter(({ source }) => !/<Heading level="screen"(?:\s[^>]*)?>/.test(source))
      .map(({ file }) => file);

    expect(withoutHeading).toEqual([]);
  });
});
