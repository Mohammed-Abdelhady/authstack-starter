// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { loadMessages, type AppLocale } from '@/i18n/load-messages';
import { SidebarBrand } from '@/components/navigation/SidebarBrand';

const request = vi.hoisted(() => ({ locale: 'en' }));

// The server entry of the library refuses to load outside a server build, so
// it is answered here from the real catalogue through the library's translator.
vi.mock('next-intl/server', () => ({
  getLocale: async () => request.locale,
  getTranslations: async ({ locale, namespace }: { locale: AppLocale; namespace: string }) => {
    const { createTranslator } = await import('next-intl');
    const { loadMessages: load } = await import('@/i18n/load-messages');
    return createTranslator({ locale, messages: await load(locale), namespace });
  },
}));
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '' }),
  Geist_Mono: () => ({ variable: '' }),
  Noto_Sans_Arabic: () => ({ variable: '' }), // feature:locale-ar
}));
vi.mock('../globals.css', () => ({}));
vi.mock('@/components/providers', () => ({ AppProviders: () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { generateMetadata } from '../layout';

afterEach(cleanup);

/** The product name as the signed-in pages show it. */
async function brandOnThePage(locale: AppLocale): Promise<string> {
  render(
    <NextIntlClientProvider locale={locale} messages={await loadMessages(locale)} timeZone="UTC">
      <SidebarBrand />
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('sidebar-brand-link').textContent ?? '';
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('document title in %s', (locale) => {
  it('names the product the way the page does', async () => {
    request.locale = locale;
    const brand = await brandOnThePage(locale);

    const metadata = await generateMetadata();

    expect(brand).not.toBe('');
    expect(metadata.title).toEqual({ default: brand, template: `%s | ${brand}` });
  });

  it('describes the product in the language of the page', async () => {
    request.locale = locale;

    const metadata = await generateMetadata();

    expect(metadata.description).toBe(
      lookupMessage(await loadMessages(locale), 'common.appDescription'),
    );
  });
});
