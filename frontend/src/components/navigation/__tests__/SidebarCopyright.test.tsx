// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { loadMessages, type AppLocale } from '@/i18n/load-messages';
import { formatter } from '@/tests/serverRejectionHarness';
import { SidebarBrand } from '../SidebarBrand';
import { SidebarCopyright } from '../SidebarCopyright';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** The browser's own clock, years away from the instant the request carries. */
const WALL_CLOCK = new Date('2019-03-01T08:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: WALL_CLOCK });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderShell(locale: AppLocale, now: string) {
  const messages: AbstractIntlMessages = await loadMessages(locale);
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" now={new Date(now)}>
      <SidebarBrand />
      <SidebarCopyright />
    </NextIntlClientProvider>,
  );
  return {
    brand: lookupMessage(messages, 'common.appName'),
    format: formatter(locale, messages),
  };
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('sidebar brand and copyright in %s', (locale) => {
  it('prints the year of the request instant, not of the wall clock', async () => {
    const { brand, format } = await renderShell(locale, '2031-06-15T12:00:00.000Z');

    expect(screen.getByTestId('sidebar-copyright').textContent).toBe(
      format('common.copyright', { year: '2031', name: brand }),
    );
  });

  it.each([
    ['2030-12-31T22:00:00.000Z', '2030'],
    ['2030-12-31T23:59:59.999Z', '2030'],
    ['2031-01-01T00:00:00.000Z', '2031'],
    ['2031-01-01T02:00:00.000Z', '2031'],
  ])('reads the year of %s in UTC as %s', async (now, year) => {
    const { brand, format } = await renderShell(locale, now);

    expect(screen.getByTestId('sidebar-copyright').textContent).toBe(
      format('common.copyright', { year, name: brand }),
    );
  });

  it('names the product the same way in the header link and the copyright line', async () => {
    const { brand, format } = await renderShell(locale, '2031-06-15T12:00:00.000Z');

    const link = screen.getByRole('link', {
      name: format('dashboard.shell.brandHome', { name: brand }),
    });
    expect(brand.trim()).not.toBe('');
    expect(link.textContent).toBe(brand);
    expect(screen.getByTestId('sidebar-copyright').textContent).toContain(brand);
  });
});
