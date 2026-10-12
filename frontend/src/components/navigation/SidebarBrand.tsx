'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';

export interface SidebarBrandProps {
  /** Called after the link is followed, so the mobile drawer can close itself. */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Product name in the sidebar. It is a link to the dashboard, not a heading:
 * the page title owns the single h1 on every page.
 */
export function SidebarBrand({ onNavigate, className }: SidebarBrandProps): React.JSX.Element {
  const t = useTranslations('dashboard.shell');
  const tCommon = useTranslations('common');
  const name = tCommon('appName');

  return (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      aria-label={t('brandHome', { name })}
      className={cn(
        'rounded-md text-xl font-bold text-foreground transition-colors hover:text-primary',
        FOCUS_RING_CLASSES,
        className,
      )}
      data-testid="sidebar-brand-link"
    >
      {name}
    </Link>
  );
}
