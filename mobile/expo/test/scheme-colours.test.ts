import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebugScreen } from '../src/screen/DebugScreen';
import { StartNotice } from '../src/screen/StartNotice';
import { startShell } from './support/shell';
import { ofKind, paint } from './support/painted';

const native = await vi.hoisted(async () => (await import('./support/painted')).createFakeNative());

vi.mock('react-native', () => native.module);
/** A single pass has no later change to hear, so the store is read once where it stands. */
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: <T>(_subscribe: unknown, read: () => T): T => read(),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

/** Written by hand from the token file's literals, so a changed or swapped palette fails here. */
const EXPECTED = {
  light: { text: '#10201B', background: '#EEF2F0', bar: 'dark-content' },
  dark: { text: '#E4EDE9', background: '#0C1412', bar: 'light-content' },
} as const;

/** The screen is painted in the last language the app ships, with the direction it reads in. */
const SHIPPED = [
  { locale: 'en', direction: 'ltr' },
  { locale: 'ar', direction: 'rtl' }, // feature:locale-ar
] as const;
const SHOWN = SHIPPED[SHIPPED.length - 1];

const SCHEMES = [
  ['light', 'light'],
  ['dark', 'dark'],
  [null, 'light'],
] as const;

describe.each(SCHEMES)('the start notice when the system reports %j', (reported, scheme) => {
  const expected = EXPECTED[scheme];
  const painted = () =>
    paint(native, reported, createElement(StartNotice, { text: 'x', direction: 'rtl' }));

  it('writes in the palette text colour', () => {
    const [text] = ofKind(painted(), 'Text');

    expect(text?.style.color).toBe(expected.text);
  });

  it('fills the window with the palette background', () => {
    const [root] = painted();

    expect(root?.kind).toBe('View');
    expect(root?.style.backgroundColor).toBe(expected.background);
    expect(root?.style.flex).toBe(1);
  });

  it('draws the status bar in the shade that reads on that background', () => {
    expect(ofKind(painted(), 'StatusBar').map((bar) => bar.props.barStyle)).toEqual([expected.bar]);
  });

  it('keeps the reading direction and the safe area it was given', () => {
    const [text] = ofKind(painted(), 'Text');

    expect(text?.style.writingDirection).toBe('rtl');
    expect(text?.style.marginTop).toBe(59);
  });
});

describe.each(SCHEMES)(
  'the sign-in check screen when the system reports %j',
  (reported, scheme) => {
    const expected = EXPECTED[scheme];
    const shells: ReturnType<typeof startShell>[] = [];
    const painted = () => {
      const shell = startShell();
      shells.push(shell);
      return paint(
        native,
        reported,
        createElement(DebugScreen, {
          auth: shell.auth,
          locale: SHOWN.locale,
          onClose: () => undefined,
        }),
      );
    };

    afterEach(() => {
      for (const shell of shells.splice(0)) shell.auth.engine.dispose();
    });

    it('writes every line in the palette text colour', () => {
      const lines = ofKind(painted(), 'Text');

      expect(lines).toHaveLength(8);
      expect(lines.map((line) => line.style.color)).toEqual(Array(8).fill(expected.text));
    });

    it('fills the scroll area with the palette background', () => {
      const [scroll] = ofKind(painted(), 'ScrollView');

      expect(scroll?.style.backgroundColor).toBe(expected.background);
    });

    it('draws the status bar in the shade that reads on that background', () => {
      expect(ofKind(painted(), 'StatusBar').map((bar) => bar.props.barStyle)).toEqual([
        expected.bar,
      ]);
    });

    it('keeps every line reading in the direction of its language', () => {
      const directions = ofKind(painted(), 'Text').map((line) => line.style.writingDirection);

      expect(directions).toEqual(Array(8).fill(SHOWN.direction));
    });
  },
);
