import { startingNotice } from '@app/native-ui/host';
import { createElement, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ofKind, paint } from './support/painted';

const native = await vi.hoisted(async () => (await import('./support/painted')).createFakeNative());

vi.mock('react-native', () => native.module);
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
/** The device key is a native module. Here it has not answered yet, as in the first frames of a launch. */
vi.mock('../src/start', () => ({ START: new Promise(() => undefined) }));

/** Written by hand from the palette of each scheme. */
const SCHEMES = [
  ['light', { background: '#EEF2F0', text: '#10201B', bar: 'dark-content' }],
  ['dark', { background: '#0C1412', text: '#E4EDE9', bar: 'light-content' }],
  [null, { background: '#EEF2F0', text: '#10201B', bar: 'dark-content' }],
] as const;

const DEVICES = [
  { tag: 'en-GB', locale: 'en', direction: 'ltr' },
  { tag: 'ar-EG', locale: 'ar', direction: 'rtl' }, // feature:locale-ar
] as const;

/** The app reads the device language once, when it is loaded. */
async function appOn(tag: string) {
  vi.resetModules();
  vi.stubGlobal('__DEV__', true);
  const read = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    locale: tag,
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'UTC',
  });
  try {
    return (await import('../src/App')).default;
  } finally {
    read.mockRestore();
    vi.unstubAllGlobals();
  }
}

describe.each(DEVICES)('the bare app on $tag before the key answers', (device) => {
  let App: Awaited<ReturnType<typeof appOn>>;

  beforeAll(async () => {
    App = await appOn(device.tag);
  });

  it.each(SCHEMES)('fills the window and says it is starting, in %j', (reported, expected) => {
    const painted = paint(native, reported, createElement(App));
    const [root] = painted;
    const [text] = ofKind(painted, 'Text');

    expect(root?.kind).toBe('View');
    expect(root?.style).toMatchObject({
      flex: 1,
      backgroundColor: expected.background,
      paddingTop: 47,
      direction: device.direction,
    });
    expect(ofKind(painted, 'StatusBar').map((bar) => bar.props.barStyle)).toEqual([expected.bar]);
    expect(text?.text).toBe(startingNotice(device.locale).text);
    expect(text?.style).toMatchObject({ color: expected.text, writingDirection: device.direction });
  });
});
