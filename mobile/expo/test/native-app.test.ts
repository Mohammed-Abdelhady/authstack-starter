import { NativeApp } from '@app/native-ui';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startShell } from './support/shell';
import { ofKind, paint } from './support/painted';

const native = await vi.hoisted(async () => (await import('./support/painted')).createFakeNative());

vi.mock('react-native', () => native.module);
/** A single pass has no later change to hear, so the store is read once where it stands. */
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: <T>(_subscribe: unknown, read: () => T): T => read(),
}));

/** Written by hand: the bar is drawn in the shade that reads on each scheme's background. */
const SCHEMES = [
  ['light', { bar: 'dark-content', background: '#EEF2F0' }],
  ['dark', { bar: 'light-content', background: '#0C1412' }],
  [null, { bar: 'dark-content', background: '#EEF2F0' }],
] as const;

const SHIPPED = [
  { locale: 'en', direction: 'ltr' },
  { locale: 'ar', direction: 'rtl' }, // feature:locale-ar
] as const;

describe.each(SCHEMES)('the screens when the system reports %j', (reported, expected) => {
  const shells: ReturnType<typeof startShell>[] = [];
  const painted = (shown: (typeof SHIPPED)[number] = SHIPPED[0]) => {
    const shell = startShell();
    shells.push(shell);
    return paint(
      native,
      reported,
      createElement(NativeApp, {
        engine: shell.auth.engine,
        appName: 'Field Notes',
        locale: shown.locale,
        insets: { top: 59, bottom: 34, start: 0, end: 0 },
      }),
    );
  };

  afterEach(() => {
    for (const shell of shells.splice(0)) shell.auth.engine.dispose();
  });

  it('draws one status bar, in the shade that reads on that background', () => {
    expect(ofKind(painted(), 'StatusBar').map((bar) => bar.props.barStyle)).toEqual([expected.bar]);
  });

  it('fills the window behind the bar with the palette background', () => {
    const [root] = painted();

    expect(root?.kind).toBe('View');
    expect(root?.style.backgroundColor).toBe(expected.background);
    expect(root?.style.flex).toBe(1);
  });

  it.each(SHIPPED)('lays the window out in the direction of $locale', (shown) => {
    const [root] = painted(shown);

    expect(root?.style.direction).toBe(shown.direction);
  });
});
