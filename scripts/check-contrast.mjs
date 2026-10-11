import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function hslToRgb(h, s, l) {
  const sat = s / 100;
  const lum = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n) => lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function sRgbToLinear(c) {
  const channel = c / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
  return (
    0.2126 * sRgbToLinear(r) +
    0.7152 * sRgbToLinear(g) +
    0.0722 * sRgbToLinear(b)
  );
}

export function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

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
];

// A control on a status surface is read from source: the primitive's classes,
// then the caller's `className`, where the later colour wins as in tailwind-merge.
export const SURFACE_CONTROLS = [
  {
    surface: 'warning',
    primitive: 'frontend/src/components/ui/checkbox.tsx',
    usage: 'frontend/src/modules/permissions/components/selector/PermissionSelector.tsx',
    element: 'Checkbox',
    testId: 'wildcard-permission-checkbox',
  },
];

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

  return [
    { token: roles.border, background: surface, target: CONTROL_MINIMUM, part: 'border' },
    {
      token: roles.checkedFill,
      background: surface,
      target: CONTROL_MINIMUM,
      part: 'checked fill',
    },
    {
      token: roles.checkMark,
      background: roles.checkedFill,
      target: CONTROL_MINIMUM,
      part: 'check mark',
    },
    { token: roles.ring, background: surface, target: CONTROL_MINIMUM, part: 'focus ring' },
    {
      token: roles.ring,
      background: roles.ringOffset,
      target: CONTROL_MINIMUM,
      part: 'focus ring on its offset',
    },
  ];
}

export function loadControlPairs(knownTokens, controls = SURFACE_CONTROLS) {
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

  return controls.flatMap(({ surface, primitive, usage, element, testId }) => {
    const baseClasses = [...read(primitive).matchAll(QUOTED_STRING)]
      .map(([, single, double]) => single ?? double)
      .join(' ');
    const overrideClasses = extractClassName(read(usage), element, testId);
    return controlPairs(resolveControlTokens(baseClasses, overrideClasses, knownTokens), surface);
  });
}

function run() {
  const css = loadCss();
  const { light, dark } = parseTokens(css);
  const pairs = [...CONTRAST_PAIRS, ...loadControlPairs(Object.keys(light))];

  let failedCount = 0;
  let totalCount = 0;

  function evaluateTheme(themeName, tokens) {
    console.log(`\n=== ${themeName.toUpperCase()} THEME CONTRAST AUDIT ===`);
    console.log(
      `${'Token'.padEnd(24)} ${'Background'.padEnd(16)} ${'Ratio'.padEnd(10)} ${'Target'.padEnd(8)} Status`,
    );
    console.log('-'.repeat(68));

    for (const { token, background, target, part } of pairs) {
      totalCount++;
      const tVal = tokens[token];
      const bgVal = tokens[background];

      if (!tVal || !bgVal) {
        console.log(
          `${token.padEnd(24)} ${background.padEnd(16)} MISSING TOKEN`,
        );
        failedCount++;
        continue;
      }

      const ratio = contrastRatio(hslToRgb(...tVal), hslToRgb(...bgVal));
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
