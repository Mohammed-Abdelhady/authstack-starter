// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { getTextDirection } from '@/i18n/direction';
import { loadMessages } from '@/i18n/load-messages';
import { DirectionProvider } from './DirectionProvider';

/** The shortcut the toast library appends to the region's name. */
const HOTKEY = 'alt+T';

// jsdom has no media queries, and the toast library asks for the colour scheme.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('toast region in %s', (locale) => {
  it('is named from the catalogue', async () => {
    const messages = await loadMessages(locale);
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <DirectionProvider dir={getTextDirection(locale)}>
          <main />
        </DirectionProvider>
      </NextIntlClientProvider>,
    );

    const name = lookupMessage(messages, 'common.toastRegion');
    expect(name.trim()).not.toBe('');
    expect(screen.getByRole('region', { name: `${name} ${HOTKEY}` })).toBeTruthy();
  });
});
