'use client';

import { Description, Heading } from '@/components/design-system';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';

/** Keys of the bullet list under auth.oauth.errorPage. */
const REASON_KEYS = ['reasonCancelled', 'reasonTimeout', 'reasonProvider', 'reasonLinked'];

/**
 * OAuth Error Page
 * Displays user-friendly error message when OAuth authentication fails
 */
export default function OAuthErrorPage() {
  const t = useTranslations('auth.oauth.errorPage');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center" data-testid="oauth-error-page">
        {/* Error Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
        </div>

        {/* Error Message */}
        <Heading level={1} variant="display" className="mb-2">
          {t('title')}
        </Heading>

        <Description variant="lead" className="mb-6">
          {t('description')}
        </Description>

        {/* Helpful Information */}
        <div className="mb-8 rounded-lg bg-muted/50 p-6 text-start">
          <Heading level={2} variant="sectionTitle" className="mb-3">
            {t('reasonsTitle')}
          </Heading>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {REASON_KEYS.map((key) => (
              <li key={key} className="flex items-start">
                <span className="me-2 text-destructive" aria-hidden="true">
                  •
                </span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild className="w-full sm:w-auto" data-testid="try-again-button">
            <Link href="/auth/login">{t('tryAgain')}</Link>
          </Button>
          <Button
            variant="outline"
            asChild
            className="w-full sm:w-auto"
            data-testid="go-home-button"
          >
            <Link href="/">{t('goHome')}</Link>
          </Button>
        </div>

        {/* Additional Help */}
        <p className="mt-6 text-sm text-muted-foreground">
          {t.rich('help', {
            link: (chunks) => (
              <Link
                href="/auth/login"
                data-testid="oauth-error-login-link"
                className={cn('text-primary hover:underline', FOCUS_RING_CLASSES)}
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
