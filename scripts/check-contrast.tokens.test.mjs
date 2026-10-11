import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTokens } from './check-contrast.mjs';

test('a color-scheme rule on html.dark does not shadow the dark token block', () => {
  const css = `
    :root { --x: 220 14% 97%; }
    html.dark { color-scheme: dark; }
    .dark { --x: 224 71% 5%; }
  `;

  assert.deepEqual(parseTokens(css), {
    light: { x: [220, 14, 97] },
    dark: { x: [224, 71, 5] },
  });
});

test('a token defined for one theme is absent from the other', () => {
  const css = `
    :root { --only-light: 0 0% 100%; }
    .dark { --only-dark: 0 0% 0%; }
  `;

  assert.deepEqual(parseTokens(css), {
    light: { 'only-light': [0, 0, 100] },
    dark: { 'only-dark': [0, 0, 0] },
  });
});

test('blocks with the same selector merge and the later one wins', () => {
  const css = `
    .dark { --x: 1 2% 3%; --y: 4 5% 6%; }
    .dark { --x: 7 8% 9%; --z: 10 11% 12%; }
  `;

  assert.deepEqual(parseTokens(css).dark, {
    x: [7, 8, 9],
    y: [4, 5, 6],
    z: [10, 11, 12],
  });
});

test('a stylesheet without theme blocks yields no tokens', () => {
  assert.deepEqual(parseTokens('body { color: red; }'), { light: {}, dark: {} });
  assert.deepEqual(parseTokens(''), { light: {}, dark: {} });
});

test('a theme block inside a comment is ignored', () => {
  const css = `
    /* .dark { --x: 1 2% 3%; } */
    .dark { --x: 215 20% 41%; }
  `;

  assert.deepEqual(parseTokens(css).dark, { x: [215, 20, 41] });
});

test('nested blocks are read and a nested html.dark is still skipped', () => {
  const css = `
    @layer base {
      :root { --x: 220 13% 58%; }
      .dark { --x: 215 20% 41%; }
      html.dark { color-scheme: dark; --x: 1 2% 3%; }
    }
  `;

  assert.deepEqual(parseTokens(css), {
    light: { x: [220, 13, 58] },
    dark: { x: [215, 20, 41] },
  });
});

test('a theme block right after an at-rule statement is read', () => {
  const css = `@import 'tailwindcss';
    :root { --x: 220 13% 58%; }`;

  assert.deepEqual(parseTokens(css).light, { x: [220, 13, 58] });
});

test('only hsl triplets are tokens and decimals are kept', () => {
  const css = ':root { --radius: 0.5rem; --x: 220.5 13.25% 58%; --font: var(--geist); }';

  assert.deepEqual(parseTokens(css).light, { x: [220.5, 13.25, 58] });
});
