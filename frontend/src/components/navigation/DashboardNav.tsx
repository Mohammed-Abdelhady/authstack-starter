'use client';

import { useId, useSyncExternalStore } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';
import { PermissionGuard } from '@/modules/permissions';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type NavItem, NAV_SECTIONS, isNavSection } from './navConfig';

const STORAGE_KEY = 'sidebar-collapsed-sections';
const EMPTY_SECTIONS: Record<string, boolean> = {};
let cachedRaw: string | null = null;
let cachedParsed: Record<string, boolean> = EMPTY_SECTIONS;
const listeners = new Set<() => void>();

function getSectionsSnapshot(): Record<string, boolean> {
  if (typeof window === 'undefined') {
    return EMPTY_SECTIONS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedParsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : EMPTY_SECTIONS;
    }
  } catch {
    cachedParsed = EMPTY_SECTIONS;
  }
  return cachedParsed;
}

function getServerSectionsSnapshot(): Record<string, boolean> {
  return EMPTY_SECTIONS;
}

function subscribeSections(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}

function setCollapsedSectionsStorage(
  updater: (prev: Record<string, boolean>) => Record<string, boolean>,
) {
  if (typeof window === 'undefined') return;
  const current = getSectionsSnapshot();
  const next = updater(current);
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedParsed = next;
  } catch {
    // Ignore storage write errors
  }
  listeners.forEach((listener) => listener());
}

export interface DashboardNavProps {
  /**
   * Optional callback when a navigation item is clicked (for mobile auto-close)
   */
  onNavigate?: () => void;
}

export function DashboardNav({ onNavigate }: DashboardNavProps = {}) {
  const pathname = usePathname();
  const t = useTranslations('dashboard.nav');
  const tShell = useTranslations('dashboard.shell');
  const navId = useId();

  const collapsedSections = useSyncExternalStore(
    subscribeSections,
    getSectionsSnapshot,
    getServerSectionsSnapshot,
  );

  const toggleSection = (sectionKey: string) => {
    setCollapsedSectionsStorage((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive =
      pathname === item.href || (Boolean(pathname) && pathname.startsWith(`${item.href}/`));
    const label = t(item.labelKey);

    const navLink = (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground forced-colors:underline'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          FOCUS_RING_CLASSES,
        )}
        data-testid={`nav-link-${item.labelKey}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </Link>
    );

    // If no permission required, always show
    if (!item.permission && !item.permissions && !item.anyPermissions) {
      return <div key={item.href}>{navLink}</div>;
    }

    // Wrap with permission guard
    return (
      <PermissionGuard
        key={item.href}
        permission={item.permission}
        permissions={item.permissions}
        anyPermissions={item.anyPermissions}
      >
        {navLink}
      </PermissionGuard>
    );
  };

  return (
    <nav className="space-y-1" aria-label={tShell('mainNavigation')} data-testid="dashboard-nav">
      {NAV_SECTIONS.map((item) => {
        if (isNavSection(item)) {
          // Collapsible Section
          const isCollapsed = collapsedSections[item.titleKey] ?? false;
          const SectionIcon = item.icon;
          const sectionTitle = t(item.titleKey);
          const sectionItemsId = `${navId}-${item.titleKey}`;

          return (
            <PermissionGuard
              key={item.titleKey}
              permission={item.permission}
              permissions={item.permissions}
              anyPermissions={item.anyPermissions}
            >
              <div className="space-y-1">
                {/* Section Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(item.titleKey)}
                  aria-expanded={!isCollapsed}
                  aria-controls={sectionItemsId}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                    FOCUS_RING_CLASSES,
                  )}
                  data-testid={`nav-section-${item.titleKey}`}
                >
                  <div className="flex items-center gap-3">
                    <SectionIcon className="h-4 w-4" aria-hidden="true" />
                    <span>{sectionTitle}</span>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>

                {/* Section Items */}
                {!isCollapsed && (
                  <div
                    id={sectionItemsId}
                    className="ms-4 space-y-1 border-s border-border ps-3"
                    data-testid={`nav-section-items-${item.titleKey}`}
                  >
                    {item.items.map(renderNavItem)}
                  </div>
                )}
              </div>
            </PermissionGuard>
          );
        }

        // Regular nav item (top-level)
        return renderNavItem(item);
      })}
    </nav>
  );
}
