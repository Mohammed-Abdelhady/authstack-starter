'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface AuthMethodsLoadErrorProps {
  onRetry: () => void;
  /** True after a retry from this screen, so a second failure hands the focus back. */
  takeFocus: boolean;
  className?: string;
  testId?: string;
}

/**
 * Says that the sign-in methods could not be read and offers to ask again. A
 * failed read is never shown as a deployment with the method turned off.
 */
export function AuthMethodsLoadError({
  onRetry,
  takeFocus,
  className,
  testId = 'auth-methods-error',
}: AuthMethodsLoadErrorProps) {
  const t = useTranslations('auth.methods');
  const tCommon = useTranslations('common');

  return (
    <div
      className={cn('flex flex-col items-center gap-4 text-center', className)}
      data-testid={testId}
    >
      <p className="text-sm text-muted-foreground" role="alert">
        {t('loadFailed')}
      </p>
      <Button type="button" onClick={onRetry} autoFocus={takeFocus}>
        {tCommon('retry')}
      </Button>
    </div>
  );
}

interface AuthMethodsLoadErrorCardProps extends Omit<AuthMethodsLoadErrorProps, 'className'> {
  /** The title of the settings card this stands in for. */
  title: string;
}

/** The same failure inside a settings card that depends on the methods read. */
export function AuthMethodsLoadErrorCard({ title, ...error }: AuthMethodsLoadErrorCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <AuthMethodsLoadError {...error} />
      </CardContent>
    </Card>
  );
}
