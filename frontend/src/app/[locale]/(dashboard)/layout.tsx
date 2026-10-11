'use client';

import { useTranslations } from 'next-intl';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { MobileNavSheet } from '@/components/navigation/MobileNavSheet';
import { SidebarBrand } from '@/components/navigation/SidebarBrand';
import { SidebarPanel } from '@/components/navigation/SidebarPanel';
import { LanguageSwitcher } from '@/components/LanguageSwitcher'; // feature:locale-ar
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { LogoutButton } from '@/modules/auth/components/LogoutButton';
import { useAppSelector } from '@/store/hooks';
import { selectUser } from '@/modules/auth/store/authSlice';

/**
 * Dashboard shell: fixed sidebar from `md` up, drawer below it, a header
 * with wrapping account controls, and the single `main#main` the skip link targets.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('dashboard.shell');
  const user = useAppSelector(selectUser);

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <aside
          className="fixed start-0 top-0 z-40 hidden h-screen w-64 border-e border-border bg-background md:block"
          data-testid="dashboard-sidebar"
        >
          <SidebarPanel />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:ms-64">
          <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2 md:flex-nowrap md:px-6 md:py-0">
            <div className="flex items-center gap-2 md:hidden">
              <MobileNavSheet />
              <SidebarBrand />
            </div>

            <div
              role="group"
              aria-label={t('accountControls')}
              className="ms-auto flex items-center gap-2"
              data-testid="dashboard-account-controls"
            >
              {user && (
                <div className="hidden min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2 [overflow-wrap:anywhere] sm:flex">
                  <span
                    dir="auto"
                    className="text-sm font-medium text-foreground"
                    data-testid="dashboard-user-name"
                  >
                    {user.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    (
                    <span dir="ltr" data-testid="dashboard-user-role">
                      {user.role}
                    </span>
                    )
                  </span>
                </div>
              )}
              <LanguageSwitcher /> {/* feature:locale-ar */}
              <ThemeSwitcher />
              <LogoutButton />
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="flex-1 focus-visible:outline-none"
            data-testid="dashboard-main"
          >
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
