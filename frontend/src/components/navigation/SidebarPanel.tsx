'use client';

import type { ReactNode } from 'react';
import { DashboardNav } from './DashboardNav';
import { SidebarBrand } from './SidebarBrand';
import { SidebarCopyright } from './SidebarCopyright';

export interface SidebarPanelProps {
  /** Called when a nav link is followed, so the mobile drawer can close itself. */
  onNavigate?: () => void;

  /** Extra control rendered at the end of the brand row, such as a close button. */
  headerAction?: ReactNode;
}

/**
 * Column shared by the fixed desktop sidebar and the mobile drawer:
 * brand row, navigation, footer.
 */
export function SidebarPanel({ onNavigate, headerAction }: SidebarPanelProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col" data-testid="sidebar-panel">
      <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-6">
        <SidebarBrand onNavigate={onNavigate} />
        {headerAction}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DashboardNav onNavigate={onNavigate} />
      </div>

      <div className="border-t border-border p-4">
        <SidebarCopyright />
      </div>
    </div>
  );
}
