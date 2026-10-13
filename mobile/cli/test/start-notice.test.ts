import { startingNotice } from '@app/native-ui/host';
import { createElement, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ofKind, paint } from './support/painted';

const native = await vi.hoisted(async () => (await import('./support/painted')).createFakeNative());

vi.mock('react-native', () => native.module);
const fonts = vi.hoisted(() => ({ loaded: true, error: null as Error | null }));
vi.mock('expo-font', () => ({ useFonts: () => [fonts.loaded, fonts.error] as const }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
/** The device key is a native module. Here it has not answered yet, as in the first frames of a launch. */
vi.mock('../src/start', () => ({ START: new Promise(() => undefined) }));

const FONT_RESULTS = [
  { name: 'loading', loaded: false, error: null },
  { name: 'loaded', loaded: true, error: null },
  { name: 'failed', loaded: false, error: new Error('font bridge unavailable') },
] as const;

const SCHEMES = ['light', 'dark', null] as const;

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

  describe.each(FONT_RESULTS)('with fonts $name', (result) => {
    it.each(SCHEMES)('announces startup in %j', (reported) => {
      fonts.loaded = result.loaded;
      fonts.error = result.error;
      const painted = paint(native, reported, createElement(App));
      const [text] = ofKind(painted, 'Text');

      expect(text?.text).toBe(startingNotice(device.locale).text);
    });
  });
});
