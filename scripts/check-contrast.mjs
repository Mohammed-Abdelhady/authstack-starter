import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compositeOver, contrastRatio, hslToRgb, pairRatio } from './contrast-math.mjs';

export { compositeOver, contrastRatio, hslToRgb, pairRatio };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const THEME_SELECTORS = { light: ':root', dark: '.dark' };
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const RULE_BLOCK = /([^{}]+)\{([^{}]*)\}/g;
const HSL_TOKEN = /--([a-z0-9-]+)\s*:\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%/g;

// A theme is every block whose selector is exactly the theme's, merged in
// source order. `html.dark { color-scheme: dark; }` is not the token block.
export function parseTokens(cssContent) {
  const themes = { light: {}, dark: {} };

  for (const [, prelude, body] of cssContent.replace(CSS_COMMENT, '').matchAll(RULE_BLOCK)) {
    const selectors = prelude
      .split(';')
      .pop()
      .split(',')
      .map((selector) => selector.trim());

    for (const [theme, selector] of Object.entries(THEME_SELECTORS)) {
      if (!selectors.includes(selector)) continue;
      for (const [, name, hue, saturation, lightness] of body.matchAll(HSL_TOKEN)) {
        themes[theme][name] = [
          Number.parseFloat(hue),
          Number.parseFloat(saturation),
          Number.parseFloat(lightness),
        ];
      }
    }
  }

  return themes;
}

export function loadCss() {
  const globalsPath = path.resolve(__dirname, '../frontend/src/app/globals.css');
  let content = fs.readFileSync(globalsPath, 'utf8');

  // Follow relative imports
  const importRegex = /@import\s+['"](\.[^'"]+)['"];/g;
  let importMatch;
  while ((importMatch = importRegex.exec(content)) !== null) {
    const importedPath = path.resolve(path.dirname(globalsPath), importMatch[1]);
    if (fs.existsSync(importedPath)) {
      content += '\n' + fs.readFileSync(importedPath, 'utf8');
    }
  }

  return content;
}

// Form fields are filled with `background`, bordered with `input`, and sit on
// either the page (`background`) or a card.
export const CONTRAST_PAIRS = [
  { token: 'foreground', background: 'background', target: 4.5 },
  { token: 'foreground', background: 'card', target: 4.5 },
  { token: 'card-foreground', background: 'card', target: 4.5 },
  { token: 'muted-foreground', background: 'background', target: 4.5 },
  { token: 'muted-foreground', background: 'card', target: 4.5 },
  { token: 'text-tertiary', background: 'background', target: 4.5 },
  { token: 'text-tertiary', background: 'card', target: 4.5 },
  { token: 'primary-foreground', background: 'primary', target: 4.5 },
  { token: 'destructive-foreground', background: 'destructive', target: 4.5 },
  { token: 'success-foreground', background: 'success', target: 4.5 },
  { token: 'warning-foreground', background: 'warning', target: 4.5 },
  { token: 'info-foreground', background: 'info', target: 4.5 },
  { token: 'status-success', background: 'background', target: 4.5 },
  { token: 'status-warning', background: 'background', target: 4.5 },
  { token: 'status-danger', background: 'background', target: 4.5 },
  { token: 'input', background: 'background', target: 3.0 },
  { token: 'input', background: 'card', target: 3.0 },
  { token: 'ring', background: 'background', target: 3.0 },
  // Admin screens: text on the muted panels, error text in a dialog, status icons.
  { token: 'muted-foreground', background: 'muted', target: 4.5 },
  { token: 'foreground', background: 'muted', target: 4.5 },
  { token: 'destructive', background: 'background', target: 4.5 },
  { token: 'info', background: 'background', target: 3.0 },
  { token: 'info', background: 'popover', target: 3.0 },
  { token: 'status-warning', background: 'popover', target: 3.0 },
  { token: 'status-success', background: 'popover', target: 3.0 },
  // Password rules: the met rule on the change password card.
  { token: 'status-success', background: 'card', target: 4.5 },
];

// The result boxes of the permissions demo page: `bg-<token>/10 dark:bg-<token>/20` on a card.
const boxTint = (token) => ({ light: { token, alpha: 0.1 }, dark: { token, alpha: 0.2 } });
export const TINTED_BOX_PAIRS = [
  ...['success', 'destructive', 'info'].map((token) => ({ token: 'foreground', tint: boxTint(token) })),
  { token: 'status-success', tint: boxTint('success'), target: 3.0 },
  { token: 'status-danger', tint: boxTint('destructive'), target: 3.0 },
].map((pair) => ({ background: 'card', target: 4.5, ...pair }));

const ALERT = 'frontend/src/components/ui/alert.tsx';
const PERMISSIONS = 'frontend/src/modules/permissions/components';

// A control on a status surface is read from source: the primitive's classes,
// then the caller's `className`, where the later colour wins as in tailwind-merge.
// The wildcard checkbox sits on the soft warning note of a dialog, in two places.
export const SURFACE_CONTROLS = ['selector/PermissionSelector', 'search/PermissionSearchDialog'].map(
  (file) => ({
    surface: { usage: ALERT, variant: 'warningSoft', backdrop: 'background' },
    primitive: 'frontend/src/components/ui/checkbox.tsx',
    usage: `${PERMISSIONS}/${file}.tsx`,
    element: 'Checkbox',
    testId: 'wildcard-permission-checkbox',
  }),
);

const CONTROL_MINIMUM = 3.0;
const CONTROL_ROLE_PREFIXES = {
  border: 'border-',
  checkedFill: 'data-[state=checked]:bg-',
  checkMark: 'data-[state=checked]:text-',
  ring: 'focus-visible:ring-',
  ringOffset: 'ring-offset-',
};
const QUOTED_STRING = /'([^'\n]*)'|"([^"\n]*)"/g;

export function resolveControlTokens(baseClasses, overrideClasses, knownTokens) {
  const roles = {};

  for (const className of `${baseClasses} ${overrideClasses}`.split(/\s+/)) {
    for (const [role, prefix] of Object.entries(CONTROL_ROLE_PREFIXES)) {
      if (!className.startsWith(prefix)) continue;
      const [token, alpha] = className.slice(prefix.length).split('/');
      if (!knownTokens.includes(token)) continue;
      if (alpha !== undefined) {
        throw new Error(`${className}: a translucent control colour cannot be audited`);
      }
      roles[role] = token;
    }
  }

  return roles;
}

export function extractClassName(source, element, testId) {
  const marker = source.indexOf(`data-testid="${testId}"`);
  const start = marker === -1 ? -1 : source.lastIndexOf(`<${element}`, marker);
  const end = source.indexOf('/>', marker);
  if (start === -1 || end === -1) {
    throw new Error(`<${element} data-testid="${testId}" /> was not found`);
  }

  const tag = source.slice(start, end);
  if (!tag.includes('className=')) return '';
  const literal = /className="([^"]*)"/.exec(tag);
  if (!literal) {
    throw new Error(`<${element} data-testid="${testId}" /> needs a literal className`);
  }
  return literal[1];
}

export function controlPairs(roles, surface) {
  const missing = Object.keys(CONTROL_ROLE_PREFIXES).filter((role) => !roles[role]);
  if (missing.length > 0) {
    throw new Error(`no colour token found for: ${missing.join(', ')}`);
  }

  // `surface` is a backdrop token and, for a soft surface, the tint painted over it.
  const pair = (token, on, part) => ({ token, ...on, target: CONTROL_MINIMUM, part });
  return [
    pair(roles.border, surface, 'border'),
    pair(roles.checkedFill, surface, 'checked fill'),
    pair(roles.checkMark, { background: roles.checkedFill }, 'check mark'),
    pair(roles.ring, surface, 'focus ring'),
    pair(roles.ring, { background: roles.ringOffset }, 'focus ring on its offset'),
  ];
}

export function loadControlPairs(knownTokens, controls = SURFACE_CONTROLS) {
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

  return controls.flatMap(({ surface, primitive, usage, element, testId }) => {
    const baseClasses = [...read(primitive).matchAll(QUOTED_STRING)]
      .map(([, single, double]) => single ?? double)
      .join(' ');
    const overrideClasses = extractClassName(read(usage), element, testId);
    const { tint } = resolveTintedSurface(
      extractVariantClasses(read(surface.usage), surface.variant),
      knownTokens,
    );
    return controlPairs(resolveControlTokens(baseClasses, overrideClasses, knownTokens), {
      background: surface.backdrop,
      tint,
    });
  });
}

// Text on a tint is read from source: the variant's class string names the
// tint, its alpha in each theme and the text colour. The tint is measured as
// painted, composited over each backdrop the surface is placed on.
const PERMISSION_NODE =
  'frontend/src/modules/permissions/components/permission-tree/PermissionNode.tsx';
const NODE_SEGMENTS = ['muted-foreground', 'text-tertiary'];
// The soft alerts are notes on a page, a card or a dialog. The wildcard note
// sets its description in the muted text colour.
export const TINTED_SURFACES = [
  ...['inherited', 'direct'].map((variant) => ({
    usage: PERMISSION_NODE,
    variant,
    backdrops: ['background'],
    innerText: NODE_SEGMENTS,
  })),
  ...['info', 'warning', 'success', 'destructive'].map((status) => ({
    usage: ALERT,
    variant: `${status}Soft`,
    backdrops: ['background', 'card'],
    innerText: status === 'warning' ? ['muted-foreground'] : [],
  })),
];

const TEXT_MINIMUM = 4.5;
const TINT_CLASS = /^(dark:)?bg-([a-z0-9-]+)(?:\/(\d+))?$/;
const ICON_PREFIX = '[&>svg]:text-';

export function extractVariantClasses(source, variant) {
  const match = new RegExp(`\\b${variant}:\\s*'([^']*)'`).exec(source);
  if (!match) throw new Error(`variant "${variant}" needs a literal class string`);
  return match[1];
}

export function resolveTintedSurface(classes, knownTokens) {
  const tint = {};
  let text;
  let icon;

  for (const className of classes.split(/\s+/)) {
    const [, dark, token, percent] = TINT_CLASS.exec(className) ?? [];
    if (knownTokens.includes(token)) {
      const fill = { token, alpha: percent === undefined ? 1 : Number.parseInt(percent, 10) / 100 };
      if (dark) tint.dark = fill;
      else tint.light = fill;
    }
    const named = className.startsWith('text-') ? className.slice('text-'.length) : undefined;
    const textToken = [named, className].find((name) => knownTokens.includes(name));
    if (named !== undefined && textToken) text = textToken;
    const iconToken = className.startsWith(ICON_PREFIX) && className.slice(ICON_PREFIX.length);
    if (knownTokens.includes(iconToken)) icon = iconToken;
  }

  if (!tint.light || !text) throw new Error(`no tint or text colour found in "${classes}"`);
  const surface = { text, tint: { light: tint.light, dark: tint.dark ?? tint.light } };
  return icon ? { ...surface, icon } : surface;
}

// An icon that carries meaning needs 3:1, as a control does.
export function tintedPairs({ text, icon, tint }, backdrops, innerText = []) {
  return backdrops.flatMap((background) => [
    ...[text, ...innerText].map((token) => ({ token, background, tint, target: TEXT_MINIMUM })),
    ...(icon ? [{ token: icon, background, tint, target: CONTROL_MINIMUM }] : []),
  ]);
}

export function loadTintedPairs(knownTokens, surfaces = TINTED_SURFACES) {
  return surfaces.flatMap(({ usage, variant, backdrops, innerText }) => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', usage), 'utf8');
    const surface = resolveTintedSurface(extractVariantClasses(source, variant), knownTokens);
    return tintedPairs(surface, backdrops, innerText);
  });
}

function run() {
  const css = loadCss();
  const { light, dark } = parseTokens(css);
  const known = Object.keys(light);
  const pairs = [
    ...CONTRAST_PAIRS,
    ...TINTED_BOX_PAIRS,
    ...loadControlPairs(known),
    ...loadTintedPairs(known),
  ];

  let failedCount = 0;
  let totalCount = 0;

  function evaluateTheme(themeName, tokens) {
    console.log(`\n=== ${themeName.toUpperCase()} THEME CONTRAST AUDIT ===`);
    console.log(
      `${'Token'.padEnd(24)} ${'Background'.padEnd(16)} ${'Ratio'.padEnd(10)} ${'Target'.padEnd(8)} Status`,
    );
    console.log('-'.repeat(68));

    for (const pair of pairs) {
      const { token, target, part } = pair;
      const fill = pair.tint?.[themeName.toLowerCase()];
      const background = fill
        ? `${fill.token}/${Math.round(fill.alpha * 100)} on ${pair.background}`
        : pair.background;
      totalCount++;
      const ratio = pairRatio(pair, tokens, themeName.toLowerCase());

      if (ratio === null) {
        console.log(
          `${token.padEnd(24)} ${background.padEnd(16)} MISSING TOKEN`,
        );
        failedCount++;
        continue;
      }

      const passed = ratio >= target;
      if (!passed) {
        failedCount++;
      }

      const ratioStr = `${ratio.toFixed(2)}:1`;
      const targetStr = `>= ${target}:1`;
      const status = passed ? 'PASS' : 'FAIL';

      console.log(
        `${token.padEnd(24)} ${background.padEnd(16)} ${ratioStr.padEnd(10)} ${targetStr.padEnd(8)} ${status}${part ? ` (control ${part})` : ''}`,
      );
    }
  }

  evaluateTheme('Light', light);
  evaluateTheme('Dark', dark);

  console.log('\n' + '='.repeat(68));
  console.log(
    `Result: ${totalCount - failedCount}/${totalCount} checks passed. ${failedCount} failures.`,
  );

  if (failedCount > 0) {
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  run();
}
