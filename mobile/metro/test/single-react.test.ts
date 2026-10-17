import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { withWorkspace } from '../src/index.cjs';
import { makeWorkspace, removeWorkspaces } from './fixture';

type Config = ReturnType<typeof withWorkspace>;
type Resolve = Config['resolver']['resolveRequest'];
type Context = Parameters<Resolve>[0];

const ROOT = makeWorkspace({ 'mobile/expo': { name: '@app/mobile-expo' } });
const SHELL = join(ROOT, 'mobile/expo');
const SHELL_MANIFEST = join(ROOT, 'mobile/expo/package.json');
const SHARED_FILE = '/repo/node_modules/.pnpm/ui@1.0.0/node_modules/ui/src/button.tsx';

afterAll(removeWorkspaces);

/** Records what the resolver below was asked, and answers with a marker. */
function recorder(label: string) {
  const calls: { origin: string; moduleName: string; platform: string | null }[] = [];
  const resolve: Resolve = (context, moduleName, platform) => {
    calls.push({ origin: context.originModulePath, moduleName, platform });
    return { type: 'sourceFile', filePath: `${label}:${moduleName}` };
  };
  return { calls, resolve };
}

function resolveFrom(config: Config, context: Context, moduleName: string, platform = 'ios') {
  return config.resolver.resolveRequest(context, moduleName, platform);
}

const configured = (base: Parameters<typeof withWorkspace>[0] = {}) =>
  withWorkspace(base, SHELL, { workspaceRoot: ROOT });

it.each([
  'react',
  'react/jsx-runtime',
  'react-native',
  'react-native/Libraries/Core/InitializeCore',
])('resolves %s from the shell, whoever imports it', (moduleName) => {
  const metro = recorder('metro');
  const context = { originModulePath: SHARED_FILE, resolveRequest: metro.resolve };

  const result = resolveFrom(configured(), context, moduleName);

  expect(metro.calls).toEqual([{ origin: SHELL_MANIFEST, moduleName, platform: 'ios' }]);
  expect(result).toEqual({ type: 'sourceFile', filePath: `metro:${moduleName}` });
  expect(context.originModulePath).toBe(SHARED_FILE);
});

it.each([
  'react-dom',
  'react-native-web',
  'react-native-screens/native-stack',
  'reactive',
  '@app/sdk',
  './react',
])('leaves %s to resolve from the file that imports it', (moduleName) => {
  const metro = recorder('metro');
  const context = { originModulePath: SHARED_FILE, resolveRequest: metro.resolve };

  resolveFrom(configured(), context, moduleName, 'android');

  expect(metro.calls).toEqual([{ origin: SHARED_FILE, moduleName, platform: 'android' }]);
});

it('hands over to a resolver the base configuration already had', () => {
  const metro = recorder('metro');
  const base = recorder('base');
  const config = configured({ resolver: { resolveRequest: base.resolve } });
  const context = { originModulePath: SHARED_FILE, resolveRequest: metro.resolve };

  const shared = resolveFrom(config, context, 'react');
  const other = resolveFrom(config, context, '@app/sdk');

  expect(base.calls).toEqual([
    { origin: SHELL_MANIFEST, moduleName: 'react', platform: 'ios' },
    { origin: SHARED_FILE, moduleName: '@app/sdk', platform: 'ios' },
  ]);
  expect(metro.calls).toEqual([]);
  expect(shared).toEqual({ type: 'sourceFile', filePath: 'base:react' });
  expect(other).toEqual({ type: 'sourceFile', filePath: 'base:@app/sdk' });
});
