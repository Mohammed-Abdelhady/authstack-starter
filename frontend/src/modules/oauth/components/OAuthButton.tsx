'use client';

import { useState } from 'react';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';
import { busyPressProps } from '@/components/ui/busy';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getProviderMeta } from '../constants';
import { currentRedirectPath, startOAuthFlow } from '../utils';
import type { OAuthProviderSummary } from '../types';
import { OAuthProviderIcon } from './OAuthProviderIcon';

interface OAuthButtonProps {
  provider: OAuthProviderSummary;
  /** Path to return to after sign-in. Defaults to the page's redirect parameter. */
  redirect?: string;
  disabled?: boolean;
}

/**
 * Icon-only button that hands sign-in over to the backend start route.
 * Uses shadcn Tooltip primitive for accessible focus and hover descriptions.
 */
export function OAuthButton({ provider, redirect, disabled = false }: OAuthButtonProps) {
  const t = useTranslations('auth.oauth');
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { buttonClassName, hoverClassName } = getProviderMeta(provider.id);

  const handleClick = async () => {
    setIsRedirecting(true);
    try {
      await startOAuthFlow(provider.id, redirect ?? currentRedirectPath());
    } catch (error) {
      setIsRedirecting(false);
      reportUnlessHandled(error);
    }
  };

  const isBusy = disabled || isRedirecting;
  const label = t('signInWith', { provider: provider.displayName });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-busy={isRedirecting}
            {...busyPressProps(isRedirecting, handleClick)}
            className={cn(
              'group relative inline-flex h-14 w-14 items-center justify-center rounded-full',
              'transition-all duration-200 ease-in-out',
              FOCUS_RING_CLASSES,
              'disabled:pointer-events-none',
              buttonClassName,
              isBusy ? 'cursor-not-allowed opacity-50' : `cursor-pointer ${hoverClassName}`,
            )}
            aria-label={label}
            data-testid={`oauth-${provider.id}-button`}
          >
            {isRedirecting ? (
              <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <OAuthProviderIcon
                providerId={provider.id}
                displayName={provider.displayName}
                className="h-6 w-6 transition-transform duration-200 group-hover:scale-110"
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{provider.displayName}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
