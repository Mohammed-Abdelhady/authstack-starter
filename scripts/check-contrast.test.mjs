import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTRAST_PAIRS,
  controlPairs,
  extractClassName,
  extractVariantClasses,
  loadControlPairs,
  loadCss,
  loadTintedPairs,
  pairRatio,
  parseTokens,
  resolveControlTokens,
  resolveTintedSurface,
  SURFACE_CONTROLS,
  TINTED_SURFACES,
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

const SOFT_TINT = { light: { token: 'warning', alpha: 0.15 }, dark: { token: 'warning', alpha: 0.2 } };

test('a control is audited on its surface, its own fill and its ring offset', () => {
  assert.deepEqual(
    controlPairs(STOCK_ROLES, { background: 'warning' }).map(({ token, background, target }) => [
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

test('a control on a soft surface meets the tint, but its mark and ring offset do not', () => {
  const pairs = controlPairs(STOCK_ROLES, { background: 'card', tint: SOFT_TINT });

  assert.deepEqual(
    pairs.map(({ part, background, tint }) => [part, background, tint]),
    [
      ['border', 'card', SOFT_TINT],
      ['checked fill', 'card', SOFT_TINT],
      ['check mark', 'primary', undefined],
      ['focus ring', 'card', SOFT_TINT],
      ['focus ring on its offset', 'background', undefined],
    ],
  );
});

test('a control with an unresolved colour stops the audit', () => {
  assert.throws(
    () => controlPairs({ ...STOCK_ROLES, ring: undefined }, { background: 'warning' }),
    /ring/,
  );
});

/** The pairs that fall short of their own target, as `theme: token on backdrop`. */
function shortfalls(pairs) {
  const themes = parseTokens(loadCss());
  return Object.entries(themes).flatMap(([theme, tokens]) =>
    pairs
      .filter((pair) => !(pairRatio(pair, tokens, theme) >= pair.target))
      .map(({ token, background }) => `${theme}: ${token} on ${background}`),
  );
}
const knownTokens = () => Object.keys(parseTokens(loadCss()).light);

test('both wildcard checkboxes keep 3:1 on the soft warning note in both themes', () => {
  const pairs = loadControlPairs(knownTokens());

  assert.deepEqual(
    pairs.map(({ token, part, tint }) => `${token} ${part}${tint ? ' on warning/15' : ''}`),
    [1, 2].flatMap(() => [
      'primary border on warning/15',
      'primary checked fill on warning/15',
      'primary-foreground check mark',
      'ring focus ring on warning/15',
      'ring focus ring on its offset',
    ]),
  );
  assert.deepEqual(
    pairs.filter(({ tint }) => tint).map(({ tint }) => [tint.light.alpha, tint.dark.alpha]),
    Array.from({ length: 6 }, () => [0.15, 0.2]),
  );
  assert.deepEqual(shortfalls(pairs), []);
});

const TINT_TOKENS = ['info', 'foreground', 'text-tertiary', 'background'];

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

test('the colour of a direct icon child is read with the surface', () => {
  assert.deepEqual(
    resolveTintedSurface('bg-info/10 text-foreground [&>svg]:text-background', TINT_TOKENS).icon,
    'background',
  );
  assert.equal(
    'icon' in resolveTintedSurface('bg-info/10 text-foreground [&>svg]:text-brand', TINT_TOKENS),
    false,
  );
});

test('an icon is audited on every backdrop at 3:1 beside the text at 4.5:1', () => {
  const tint = { light: { token: 'info', alpha: 0.1 }, dark: { token: 'info', alpha: 0.2 } };

  assert.deepEqual(tintedPairs({ text: 'foreground', icon: 'info', tint }, ['background', 'card']), [
    { token: 'foreground', background: 'background', tint, target: 4.5 },
    { token: 'info', background: 'background', tint, target: 3 },
    { token: 'foreground', background: 'card', tint, target: 4.5 },
    { token: 'info', background: 'card', tint, target: 3 },
  ]);
});

test('every tinted surface keeps its text at 4.5:1 and its icon at 3:1 in both themes', () => {
  const pairs = loadTintedPairs(knownTokens());
  const onPageAndCard = (rows) =>
    ['background', 'card'].flatMap((backdrop) => rows.map((row) => `${row} over ${backdrop}`));

  assert.deepEqual(
    pairs.map(
      ({ token, tint, background, target }) =>
        `${token} on ${tint.light.token}/${tint.light.alpha * 100}/${tint.dark.alpha * 100} at ${target} over ${background}`,
    ),
    [
      'foreground on info/10/20 at 4.5 over background',
      'muted-foreground on info/10/20 at 4.5 over background',
      'text-tertiary on info/10/20 at 4.5 over background',
      'foreground on success/10/20 at 4.5 over background',
      'muted-foreground on success/10/20 at 4.5 over background',
      'text-tertiary on success/10/20 at 4.5 over background',
      ...onPageAndCard(['foreground on info/10/20 at 4.5', 'info on info/10/20 at 3']),
      ...onPageAndCard([
        'foreground on warning/15/20 at 4.5',
        'muted-foreground on warning/15/20 at 4.5',
        'status-warning on warning/15/20 at 3',
      ]),
      ...onPageAndCard(['foreground on success/10/20 at 4.5', 'status-success on success/10/20 at 3']),
      ...onPageAndCard([
        'foreground on destructive/10/20 at 4.5',
        'status-danger on destructive/10/20 at 3',
      ]),
    ],
  );
  assert.deepEqual(shortfalls(pairs), []);
});

test('a control or surface whose file is absent stops the audit instead of being skipped', () => {
  const [control] = SURFACE_CONTROLS;
  const [surface] = TINTED_SURFACES;
  const absent = 'frontend/src/components/ui/absent-control.tsx';

  assert.throws(() => loadControlPairs(KNOWN_TOKENS, [{ ...control, usage: absent }]), {
    code: 'ENOENT',
  });
  assert.throws(() => loadControlPairs(KNOWN_TOKENS, [{ ...control, primitive: absent }]), {
    code: 'ENOENT',
  });
  assert.throws(() => loadTintedPairs(KNOWN_TOKENS, [{ ...surface, usage: absent }]), {
    code: 'ENOENT',
  });
});
