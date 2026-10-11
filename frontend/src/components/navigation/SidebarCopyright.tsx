import { useNow, useTranslations } from 'next-intl';

/**
 * Copyright line under the navigation. The year comes from the request's
 * instant, read in UTC, so the server and the browser print the same one.
 */
export function SidebarCopyright(): React.JSX.Element {
  const t = useTranslations('common');
  const tShell = useTranslations('dashboard.shell');
  const year = String(useNow().getUTCFullYear());

  return (
    <p className="text-xs text-muted-foreground" data-testid="sidebar-copyright">
      {t('copyright', { year, name: tShell('brand') })}
    </p>
  );
}
