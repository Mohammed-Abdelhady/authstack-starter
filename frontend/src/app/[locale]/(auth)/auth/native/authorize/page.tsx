import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { firstValue } from '@/lib/searchParams';
import { AuthLayout } from '@/modules/auth/components/AuthLayout';
import { NATIVE_TRANSACTION_PARAM } from '@/modules/auth/constants/nativeAuthorize';
import { NativeAuthorizePanel } from '@/modules/auth/native';
import { readNativeBrowserSelectors } from '@/modules/auth/utils/nativeBrowserSelectors';

type SearchParams = Record<string, string | string[] | undefined>;

interface NativeAuthorizePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ params }: NativeAuthorizePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.nativeAuthorize' });

  return { title: t('pageTitle'), description: t('accountStatement') };
}

/**
 * Browser side of a mobile app's sign-in request.
 *
 * The backend sends the browser here with a transaction id; the panel either
 * approves the request and returns to the app, or denies it.
 */
export default async function NativeAuthorizeRoute({ searchParams }: NativeAuthorizePageProps) {
  const query = await searchParams;
  const transaction = firstValue(query[NATIVE_TRANSACTION_PARAM]);
  const selectors = readNativeBrowserSelectors(query);
  if (!selectors) notFound();

  return (
    <AuthLayout>
      <NativeAuthorizePanel transaction={transaction} selectors={selectors} />
    </AuthLayout>
  );
}
