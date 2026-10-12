'use client';

import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { ShieldAlert, Home, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorPageLayout } from '@/components/layout/ErrorPageLayout';
import { toast } from '@/lib/toast';

/**
 * 403 Forbidden Error Page
 *
 * Used when access is denied. Redirect here when user lacks permissions.
 */
export default function Forbidden() {
  const t = useTranslations('errors.403');
  const tCommon = useTranslations('errors');

  return (
    <ErrorPageLayout
      code="403"
      title={t('title')}
      description={t('description')}
      subtitle={t('subtitle')}
      icon={ShieldAlert}
      variant="destructive"
      actions={
        <>
          <Button asChild className="w-full sm:w-auto" data-testid="forbidden-dashboard-button">
            <Link href="/dashboard">
              <Home className="w-5 h-5 me-2" />
              {t('goDashboard')}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.info(tCommon('comingSoon'))}
            className="w-full sm:w-auto"
            data-testid="forbidden-contact-button"
          >
            <Mail className="w-5 h-5 me-2" />
            {t('contactSupport')}
          </Button>
        </>
      }
    />
  );
}
