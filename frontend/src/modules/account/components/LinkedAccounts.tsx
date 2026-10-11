'use client';

import { Heading } from '@/components/design-system';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useGetEnabledProvidersQuery, getProviderDisplayName } from '@/modules/oauth';
import { useGetLinkedProvidersQuery } from '../api';
import { EMAIL_PROVIDER } from '../types';
import { LinkedAccountCard } from './LinkedAccountCard';
import { LinkProviderButton } from './LinkProviderButton';

/**
 * LinkedAccounts Component
 * Lists the sign-in methods on the account and the providers still available
 */
export function LinkedAccounts() {
  const t = useTranslations('settings.accounts');
  // Takes focus once an account is unlinked: its card and buttons are gone.
  const linkedHeadingRef = useRef<HTMLHeadingElement>(null);

  const {
    data: linkedProvidersData,
    isLoading: isLoadingLinked,
    refetch,
  } = useGetLinkedProvidersQuery();

  const { data: enabledProviders = [], isLoading: isLoadingEnabled } =
    useGetEnabledProvidersQuery();

  const linkedProviders = linkedProvidersData?.providers || [];
  const primaryProvider = linkedProvidersData?.primaryProvider;

  const availableProviders = enabledProviders.filter(
    (provider) => !linkedProviders.includes(provider.id),
  );

  const unlinkHints = linkedProvidersData?.unlinkHints;
  const primaryHints = linkedProvidersData?.primaryHints;
  const emailSignIn = linkedProvidersData?.emailSignIn;

  if (isLoadingLinked || isLoadingEnabled) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {linkedProviders.length > 0 && (
          <div className="space-y-4">
            <Heading level={3} variant="subsectionTitle" ref={linkedHeadingRef} tabIndex={-1}>
              {t('linkedAccountsLabel')}
            </Heading>
            <div className="space-y-3">
              {linkedProviders.map((providerId) => (
                <LinkedAccountCard
                  key={providerId}
                  providerId={providerId}
                  displayName={
                    // The server names providers only. Email sign-in is named here.
                    providerId === EMAIL_PROVIDER
                      ? t('emailSignInName')
                      : getProviderDisplayName(providerId, enabledProviders)
                  }
                  isPrimary={providerId === primaryProvider}
                  unlinkHint={unlinkHints?.[providerId]}
                  primaryHint={primaryHints?.[providerId]}
                  emailSignIn={providerId === EMAIL_PROVIDER ? emailSignIn : undefined}
                  onChange={refetch}
                  landing={linkedHeadingRef}
                />
              ))}
            </div>
          </div>
        )}

        {availableProviders.length > 0 && (
          <div className="space-y-4">
            <Heading level={3} variant="subsectionTitle">
              {t('availableProvidersLabel')}
            </Heading>
            <div className="flex items-center gap-2 flex-wrap">
              {availableProviders.map((provider) => (
                <LinkProviderButton key={provider.id} provider={provider} />
              ))}
            </div>
          </div>
        )}

        {availableProviders.length === 0 && linkedProviders.length > 0 && (
          <Alert>
            <AlertDescription>{t('allProvidersLinked')}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
