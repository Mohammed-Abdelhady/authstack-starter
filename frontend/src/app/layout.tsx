import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { getLocale, getTranslations } from 'next-intl/server';
import { AppProviders } from '@/components/providers';
import { routing } from '@/i18n/routing';
import { getTextDirection } from '@/i18n/direction';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/** The tab title carries the product name the page itself shows, in its locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'common' });
  const name = t('appName');

  return {
    title: {
      default: name,
      template: `%s | ${name}`,
    },
    description: 'Authentication and role-based access control boilerplate',
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Root layout that wraps ALL pages (including error pages)
 * Provides global CSS, fonts, Redux, and theme support
 * Note: Error pages at root level will use default locale (en)
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <html lang={locale} dir={getTextDirection(locale)} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppProviders loadingLabel={t('loading')}>{children}</AppProviders>
      </body>
    </html>
  );
}
