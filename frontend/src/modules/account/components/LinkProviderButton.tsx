'use client';

import { useState } from 'react';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePathname } from '@/i18n/navigation';
import { getRedirectPath } from '@/modules/auth/utils';
import { OAuthProviderIcon, startOAuthFlow, type OAuthProviderSummary } from '@/modules/oauth';

interface LinkProviderButtonProps {
  provider: OAuthProviderSummary;
  disabled?: boolean;
}

/**
 * Starts the OAuth flow for a provider that is not linked yet.
 *
 * Linking runs through the same server side route as sign-in: the backend
 * attaches the provider account to the signed-in user and sends the browser
 * back to this page.
 */
export function LinkProviderButton({ provider, disabled = false }: LinkProviderButtonProps) {
  const t = useTranslations('settings.accounts');
  const pathname = usePathname();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleLinkClick = async () => {
    setIsRedirecting(true);
    try {
      await startOAuthFlow(provider.id, getRedirectPath(pathname), 'link');
    } catch (error) {
      setIsRedirecting(false);
      reportUnlessHandled(error);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleLinkClick}
      disabled={disabled}
      busy={isRedirecting}
      aria-busy={isRedirecting}
      className="w-fit justify-start"
      data-testid={`link-provider-${provider.id}`}
    >
      {isRedirecting ? (
        <>
          <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
          <span className="ms-2">{t('connecting', { provider: provider.displayName })}</span>
        </>
      ) : (
        <>
          <OAuthProviderIcon
            providerId={provider.id}
            displayName={provider.displayName}
            className="h-5 w-5 shrink-0"
          />
          <span className="ms-2">{t('linkWith', { provider: provider.displayName })}</span>
        </>
      )}
    </Button>
  );
}
