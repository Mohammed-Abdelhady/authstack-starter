import type { Metadata } from 'next';
import { headers } from 'next/headers';
import localFont from 'next/font/local';
import { getLocale, getTranslations } from 'next-intl/server';
import { AppProviders } from '@/components/providers';
import { routing } from '@/i18n/routing';
import { getTextDirection } from '@/i18n/direction';
import { NONCE_HEADER } from '@/lib/config/security-headers';
import './globals.css';
import './font-fallbacks.css';
import './arabic-font.css'; // feature:locale-ar

const geistSans = localFont({
  src: './fonts/Geist.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'swap',
  fallback: ['Geist Fallback'],
  adjustFontFallback: false,
});

const geistMono = localFont({
  src: './fonts/GeistMono.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
  fallback: ['Geist Mono Fallback'],
  adjustFontFallback: false,
});

// feature:locale-ar:start
const arabicSans = localFont({
  src: './fonts/NotoSansArabic.woff2',
  variable: '--font-arabic-sans',
  weight: '100 900',
  display: 'swap',
  preload: false,
  fallback: ['Noto Sans Arabic Fallback'],
  adjustFontFallback: false,
});
// feature:locale-ar:end

const FONT_VARIABLES = [
  geistSans.variable,
  geistMono.variable,
  arabicSans.variable, // feature:locale-ar
].join(' ');

/** The product name the page itself shows and its description, in the request locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'common' });
  const name = t('appName');

  return {
    title: {
      default: name,
      template: `%s | ${name}`,
    },
    description: t('appDescription'),
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
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html lang={locale} dir={getTextDirection(locale)} suppressHydrationWarning>
      <body className={`${FONT_VARIABLES} antialiased`}>
        <AppProviders loadingLabel={t('loading')} nonce={nonce}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
