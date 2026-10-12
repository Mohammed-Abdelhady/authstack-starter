'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useGetEnabledProvidersQuery } from '../api';
import { OAuthButton } from './OAuthButton';

interface OAuthButtonsProps {
  /** Path to return to after sign-in. Defaults to the page's redirect parameter. */
  redirect?: string;
  disabled?: boolean;
}

/**
 * Renders one button per provider the backend reports as enabled.
 */
export function OAuthButtons({ redirect, disabled = false }: OAuthButtonsProps) {
  const t = useTranslations('auth.oauth');
  const tCommon = useTranslations('common');
  const { data: providers = [], isLoading } = useGetEnabledProvidersQuery();

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-4"
        data-testid="oauth-loading"
        role="status"
      >
        <span className="sr-only">{tCommon('loading')}</span>
        <Loader2 className="h-5 w-5 motion-safe:animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (providers.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-4"
      data-testid="oauth-buttons"
      role="group"
      aria-label={t('groupLabel')}
    >
      {providers.map((provider) => (
        <OAuthButton
          key={provider.id}
          provider={provider}
          redirect={redirect}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
