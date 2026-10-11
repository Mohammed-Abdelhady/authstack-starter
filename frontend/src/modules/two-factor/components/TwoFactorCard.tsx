'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthMethodsLoadErrorCard } from '@/modules/auth/components/AuthMethodsLoadError';
import { useAuthMethods } from '@/modules/auth/hooks/useAuthMethods';
import { useGetCurrentUserQuery } from '@/modules/auth/store/authApi';
import { RegenerateCodesDialog } from './RegenerateCodesDialog';
import { TwoFactorDisableDialog } from './TwoFactorDisableDialog';
import { TwoFactorSetupDialog } from './TwoFactorSetupDialog';

/** An account that signs in with a password re-enters it for these actions. */
const EMAIL_PROVIDER = 'email';

/**
 * Second factor settings.
 *
 * The card disappears where the deployment turned two-factor off, which is
 * also where every route behind it answers FEATURE_DISABLED. Not knowing
 * whether it is off is a failure with a retry, not a card that is gone.
 */
export function TwoFactorCard() {
  const t = useTranslations('settings.twoFactor');
  const { data: user, isLoading: isLoadingUser } = useGetCurrentUserQuery();
  const {
    methods,
    isLoading: isLoadingMethods,
    isError: methodsFailed,
    retry,
    hasRetried,
  } = useAuthMethods();
  const [dialog, setDialog] = useState<'setup' | 'disable' | 'regenerate' | null>(null);

  if (isLoadingUser || isLoadingMethods) {
    return <Skeleton className="h-48 w-full" data-testid="two-factor-card-loading" />;
  }

  if (methodsFailed) {
    return (
      <AuthMethodsLoadErrorCard
        title={t('title')}
        onRetry={retry}
        takeFocus={hasRetried}
        testId="two-factor-card-error"
      />
    );
  }

  if (methods?.twoFactor !== true) {
    return null;
  }

  const isEnabled = user?.twoFactorEnabled === true;
  const hasPassword =
    methods.password && (user?.linkedProviders?.includes(EMAIL_PROVIDER) ?? false);

  return (
    <Card data-testid="two-factor-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t('title')}</CardTitle>
          <Badge
            variant={isEnabled ? 'success' : 'secondary'}
            data-testid="two-factor-status-badge"
          >
            {isEnabled ? t('statusOn') : t('statusOff')}
          </Badge>
        </div>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {isEnabled ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setDialog('regenerate')}
              data-testid="two-factor-regenerate-open"
            >
              <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
              {t('regenerate.open')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => setDialog('disable')}
              data-testid="two-factor-disable-open"
            >
              <ShieldOff className="me-2 h-4 w-4" aria-hidden="true" />
              {t('disable.open')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            className="w-full"
            onClick={() => setDialog('setup')}
            data-testid="two-factor-setup-open"
          >
            <ShieldCheck className="me-2 h-4 w-4" aria-hidden="true" />
            {t('setup.open')}
          </Button>
        )}
      </CardContent>

      <TwoFactorSetupDialog
        open={dialog === 'setup'}
        onOpenChange={(open) => setDialog(open ? 'setup' : null)}
        hasPassword={hasPassword}
      />
      <TwoFactorDisableDialog
        open={dialog === 'disable'}
        onOpenChange={(open) => setDialog(open ? 'disable' : null)}
        hasPassword={hasPassword}
      />
      <RegenerateCodesDialog
        open={dialog === 'regenerate'}
        onOpenChange={(open) => setDialog(open ? 'regenerate' : null)}
      />
    </Card>
  );
}
