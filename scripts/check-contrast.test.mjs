import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTRAST_PAIRS,
  compositeOver,
  contrastRatio,
  controlPairs,
  extractClassName,
  extractVariantClasses,
  hslToRgb,
  loadControlPairs,
  loadCss,
  loadTintedPairs,
  pairRatio,
  parseTokens,
  resolveControlTokens,
  resolveTintedSurface,
  tintedPairs,
} from './check-contrast.mjs';

const KNOWN_TOKENS = ['primary', 'primary-foreground', 'ring', 'background', 'warning', 'ink'];
const STOCK_CHECKBOX =
  'h-4 w-4 border border-primary ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground';
const STOCK_ROLES = {
  border: 'primary',
  checkedFill: 'primary',
  checkMark: 'primary-foreground',
  ring: 'ring',
  ringOffset: 'background',
};

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

test('the real stylesheets define every audited token in both themes', () => {
  const themes = parseTokens(loadCss());
  const missing = [];

  for (const [theme, tokens] of Object.entries(themes)) {
    for (const { token, background } of CONTRAST_PAIRS) {
      if (!tokens[token]) missing.push(`${theme}:${token}`);
      if (!tokens[background]) missing.push(`${theme}:${background}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('the audit covers the form field pairs at their minimums', () => {
  const fieldPairs = [
    { token: 'foreground', background: 'background', target: 4.5 },
    { token: 'muted-foreground', background: 'background', target: 4.5 },
    { token: 'input', background: 'background', target: 3 },
    { token: 'input', background: 'card', target: 3 },
  ];

  for (const pair of fieldPairs) {
    assert.deepEqual(
      CONTRAST_PAIRS.filter(
        ({ token, background }) => token === pair.token && background === pair.background,
      ),
      [pair],
    );
  }
});

test('a stock control resolves to its own colours and skips width utilities', () => {
  assert.deepEqual(resolveControlTokens(STOCK_CHECKBOX, '', KNOWN_TOKENS), STOCK_ROLES);
});

test('a caller colour replaces the stock one and leaves the others alone', () => {
  assert.deepEqual(
    resolveControlTokens(
      STOCK_CHECKBOX,
      'border-ink data-[state=checked]:bg-ink focus-visible:ring-ink',
      KNOWN_TOKENS,
    ),
    { ...STOCK_ROLES, border: 'ink', checkedFill: 'ink', ring: 'ink' },
  );
});

test('a class naming no known token does not change a colour', () => {
  assert.deepEqual(
    resolveControlTokens(STOCK_CHECKBOX, 'border-2 border-dashed ring-offset-4', KNOWN_TOKENS),
    STOCK_ROLES,
  );
});

test('a translucent control colour is refused instead of measured as solid', () => {
  assert.throws(
    () => resolveControlTokens(STOCK_CHECKBOX, 'border-warning/50', KNOWN_TOKENS),
    /border-warning\/50/,
  );
});

test('the class list comes from the element carrying the test id', () => {
  const source = `
    <Checkbox className="border-primary" data-testid="other" />
    <Checkbox
      id="x"
      className="border-ink ring-offset-warning"
      data-testid="wanted"
    />
    <Checkbox data-testid="later" className="border-ring" />
  `;

  assert.equal(extractClassName(source, 'Checkbox', 'wanted'), 'border-ink ring-offset-warning');
});

test('an element without a className adds nothing', () => {
  const source = '<Checkbox className="border-ink" /><Checkbox data-testid="wanted" />';

  assert.equal(extractClassName(source, 'Checkbox', 'wanted'), '');
});

test('a missing element or a computed className stops the audit', () => {
  assert.throws(() => extractClassName('<Checkbox />', 'Checkbox', 'wanted'), /was not found/);
  assert.throws(
    () => extractClassName('<Input data-testid="wanted" />', 'Checkbox', 'wanted'),
    /was not found/,
  );
  assert.throws(
    () =>
      extractClassName('<Checkbox className={tone} data-testid="wanted" />', 'Checkbox', 'wanted'),
    /literal className/,
  );
});

test('a control is audited on its surface, its own fill and its ring offset', () => {
  assert.deepEqual(
    controlPairs(STOCK_ROLES, 'warning').map(({ token, background, target }) => [
      token,
      background,
      target,
    ]),
    [
      ['primary', 'warning', 3],
      ['primary', 'warning', 3],
      ['primary-foreground', 'primary', 3],
      ['ring', 'warning', 3],
      ['ring', 'background', 3],
    ],
  );
});

test('a control with an unresolved colour stops the audit', () => {
  assert.throws(() => controlPairs({ ...STOCK_ROLES, ring: undefined }, 'warning'), /ring/);
});

test('every control placed on a status surface keeps 3:1 in both themes', () => {
  const themes = parseTokens(loadCss());
  const pairs = loadControlPairs(Object.keys(themes.light));
  const failures = [];

  for (const [theme, tokens] of Object.entries(themes)) {
    for (const { token, background, part } of pairs) {
      const ratio = contrastRatio(hslToRgb(...tokens[token]), hslToRgb(...tokens[background]));
      if (ratio < 3) failures.push(`${theme}: ${part}`);
    }
  }

  assert.equal(pairs.length, 5);
  assert.deepEqual(failures, []);
});

const TINT_TOKENS = ['info', 'foreground', 'text-tertiary', 'background'];
const GREYS = { ink: [0, 0, 0], paper: [0, 0, 100] };

test('a tint is mixed with its backdrop by its alpha', () => {
  assert.deepEqual(compositeOver([255, 255, 255], [0, 0, 0], 0.1), [25.5, 25.5, 25.5]);
  assert.deepEqual(compositeOver([200, 100, 0], [10, 20, 30], 0), [10, 20, 30]);
  assert.deepEqual(compositeOver([200, 100, 0], [10, 20, 30], 1), [200, 100, 0]);
});

test('a variant class string is read on its own line or the next', () => {
  const source = `
    inherited: 'bg-info/10 text-foreground',
    direct:
      'bg-success/10 text-foreground',
  `;

  assert.equal(extractVariantClasses(source, 'inherited'), 'bg-info/10 text-foreground');
  assert.equal(extractVariantClasses(source, 'direct'), 'bg-success/10 text-foreground');
});

test('a missing or computed variant class string stops the audit', () => {
  assert.throws(() => extractVariantClasses("direct: 'bg-info/10'", 'inherited'), /inherited/);
  assert.throws(() => extractVariantClasses('inherited: cn(base, tint)', 'inherited'), /literal/);
});

test('a tinted surface keeps its own alpha in each theme', () => {
  assert.deepEqual(
    resolveTintedSurface(
      'bg-info/10 border-info/30 text-foreground dark:bg-info/20 dark:border-info/40',
      TINT_TOKENS,
    ),
    {
      text: 'foreground',
      tint: { light: { token: 'info', alpha: 0.1 }, dark: { token: 'info', alpha: 0.2 } },
    },
  );
});

test('a tint without a dark class is the same in both themes and a plain fill is solid', () => {
  assert.deepEqual(resolveTintedSurface('bg-info text-tertiary', TINT_TOKENS), {
    text: 'text-tertiary',
    tint: { light: { token: 'info', alpha: 1 }, dark: { token: 'info', alpha: 1 } },
  });
});

test('a surface without a known tint or text colour stops the audit', () => {
  assert.throws(() => resolveTintedSurface('bg-brand/10 text-foreground', TINT_TOKENS), /no tint/);
  assert.throws(() => resolveTintedSurface('bg-info/10 font-mono', TINT_TOKENS), /text colour/);
});

test('every text colour is audited on every backdrop at the text minimum', () => {
  const tint = { light: { token: 'info', alpha: 0.1 }, dark: { token: 'info', alpha: 0.2 } };

  assert.deepEqual(
    tintedPairs({ text: 'foreground', tint }, ['background', 'card'], ['text-tertiary']),
    [
      { token: 'foreground', background: 'background', tint, target: 4.5 },
      { token: 'text-tertiary', background: 'background', tint, target: 4.5 },
      { token: 'foreground', background: 'card', tint, target: 4.5 },
      { token: 'text-tertiary', background: 'card', tint, target: 4.5 },
    ],
  );
});

test('a pair is measured against the tint as painted in that theme', () => {
  const half = { token: 'paper', alpha: 0.5 };
  const tint = { light: half, dark: { token: 'paper', alpha: 1 } };
  const pair = { token: 'ink', background: 'ink', tint };

  // White at 50% over black is rgb 127.5: luminance 0.2140, so (0.2140 + 0.05) / 0.05.
  assert.equal(pairRatio(pair, GREYS, 'light').toFixed(2), '5.28');
  assert.equal(pairRatio(pair, GREYS, 'dark').toFixed(2), '21.00');
  assert.equal(pairRatio({ token: 'ink', background: 'paper' }, GREYS, 'light').toFixed(2), '21.00');
});

test('a pair naming a missing token has no ratio', () => {
  const tint = { light: { token: 'mist', alpha: 0.5 }, dark: { token: 'mist', alpha: 0.5 } };

  assert.equal(pairRatio({ token: 'ink', background: 'paper', tint }, GREYS, 'light'), null);
  assert.equal(pairRatio({ token: 'fog', background: 'paper' }, GREYS, 'light'), null);
});

test('permission keys on the inherited and direct tints keep 4.5:1 in both themes', () => {
  const themes = parseTokens(loadCss());
  const pairs = loadTintedPairs(Object.keys(themes.light));
  const failures = [];

  for (const [theme, tokens] of Object.entries(themes)) {
    for (const pair of pairs) {
      const ratio = pairRatio(pair, tokens, theme);
      if (ratio === null || ratio < 4.5) failures.push(`${theme}: ${pair.token}`);
    }
  }

  assert.deepEqual(
    pairs.map(({ token, tint }) => `${token} on ${tint.light.token}`),
    [
      'foreground on info',
      'muted-foreground on info',
      'text-tertiary on info',
      'foreground on success',
      'muted-foreground on success',
      'text-tertiary on success',
    ],
  );
  assert.deepEqual(failures, []);
});
