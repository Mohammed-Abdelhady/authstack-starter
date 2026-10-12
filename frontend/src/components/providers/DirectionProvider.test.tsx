// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { getTextDirection } from '@/i18n/direction';
import { loadMessages } from '@/i18n/load-messages';
import { DirectionProvider } from './DirectionProvider';
import { toast } from 'sonner';

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
  toast.dismiss();
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
  it('offers a focusable close control for a persistent notice', async () => {
    const messages = await loadMessages(locale);
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <DirectionProvider dir={getTextDirection(locale)}>
          <main />
        </DirectionProvider>
      </NextIntlClientProvider>,
    );
    act(() => {
      toast.error(lookupMessage(messages, 'common.welcome'), {
        id: 'persistent-notice',
        duration: Infinity,
      });
    });
    const close = await screen.findByRole('button', {
      name: lookupMessage(messages, 'common.closeToast'),
    });
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: lookupMessage(messages, 'common.closeToast') }),
      ).toBeNull(),
    );
  });
});
