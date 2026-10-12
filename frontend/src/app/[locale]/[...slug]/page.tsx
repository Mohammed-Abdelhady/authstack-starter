import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

/**
 * Catch-all route handler for unmatched paths within a locale.
 *
 * This ensures that routes like /en/random-path trigger the custom
 * not-found.tsx design instead of the default Next.js 404 page.
 */
export default function CatchAllPage() {
  notFound();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'errors.404' });
  return { title: t('title'), description: t('description') };
}
