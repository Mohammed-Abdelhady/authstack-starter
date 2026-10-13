import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTokens } from './check-contrast.mjs';
import { hslToRgb } from './contrast-math.mjs';

const WEB_TOKENS = new URL('../frontend/src/app/tokens.css', import.meta.url);
const NATIVE_COLORS = new URL('../mobile/ui/src/theme/tokens.ts', import.meta.url);
const CHECK_ONLY = process.argv[2] === '--check';
if (process.argv.length > 3 || (process.argv.length === 3 && !CHECK_ONLY)) {
  throw new Error('Usage: node scripts/sync-mobile-theme.mjs [--check]');
}
const COLOR_ROLES = {
  background: 'background',
  surface: 'card',
  text: 'foreground',
  textMuted: 'muted-foreground',
  accent: 'primary',
  onAccent: 'primary-foreground',
  secondary: 'secondary',
  onSecondary: 'secondary-foreground',
  danger: 'destructive',
  onDanger: 'destructive-foreground',
  border: 'input',
  separator: 'border',
  focus: 'ring',
  skeleton: 'muted',
};

if (!existsSync(new URL('../mobile/ui/', import.meta.url))) {
  console.log('No mobile UI workspace to synchronize.');
  process.exit(0);
}

if (!existsSync(new URL('../frontend/', import.meta.url))) {
  console.log('No web workspace; mobile retains the exported palette.');
  process.exit(0);
}

const themes = parseTokens(readFileSync(WEB_TOKENS, 'utf8'));
const lines = [
  '// web-colors:start',
  '// Native color roles from frontend/src/app/tokens.css.',
  'export const PALETTE: Record<ColorScheme, Palette> = {',
];
for (const [scheme, tokens] of Object.entries(themes)) {
  lines.push(`  ${scheme}: {`);
  for (const [role, token] of Object.entries(COLOR_ROLES)) {
    const channels = tokens[token];
    if (!channels) throw new Error(`Missing ${scheme} web token: ${token}`);
    const hex = hslToRgb(...channels)
      .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    lines.push(`    ${role}: '#${hex}',`);
  }
  lines.push('  },');
}
lines.push('};', '// web-colors:end');
const block = lines.join('\n');
const current = readFileSync(NATIVE_COLORS, 'utf8');
const marker = /\/\/ web-colors:start[\s\S]*?\/\/ web-colors:end/;
if (!marker.test(current)) throw new Error('Native color block is missing.');
const output = current.replace(marker, block);
if (!CHECK_ONLY) {
  writeFileSync(NATIVE_COLORS, output);
  console.log(`Synchronized ${fileURLToPath(NATIVE_COLORS)}`);
} else {
  if (readFileSync(NATIVE_COLORS, 'utf8') !== output) {
    throw new Error('Native colors differ from the web tokens. Run pnpm sync:mobile-theme.');
  }
  console.log('Native color roles match the web tokens.');
}
