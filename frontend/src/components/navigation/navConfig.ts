import React from 'react';
import { ACTIVITY_READ_PERMISSION } from '@/modules/activity';
import {
  USER_PERMISSIONS,
  ROLE_PERMISSIONS,
  PERMISSION_PERMISSIONS,
  SESSION_PERMISSIONS,
} from '@app/core';
import { LayoutDashboard, Users, Shield, Settings, Activity, Code } from 'lucide-react';

export interface NavItem {
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  permissions?: string[];
  anyPermissions?: string[];
}

export interface NavSection {
  titleKey: string;
  items: NavItem[];
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  permissions?: string[];
  anyPermissions?: string[];
}

export function isNavSection(item: NavItem | NavSection): item is NavSection {
  return 'titleKey' in item && 'items' in item;
}

export const NAV_SECTIONS: (NavItem | NavSection)[] = [
  // Top-level items (always visible)
  {
    labelKey: 'dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    labelKey: 'settings',
    href: '/settings',
    icon: Settings,
  },

  // Admin Section
  {
    titleKey: 'admin',
    icon: Shield,
    anyPermissions: [
      USER_PERMISSIONS.LIST_ALL,
      USER_PERMISSIONS.LIST_STAFF,
      ROLE_PERMISSIONS.LIST_ALL,
      PERMISSION_PERMISSIONS.MANAGE_ALL,
    ],
    items: [
      {
        labelKey: 'users',
        href: '/admin/users',
        icon: Users,
        anyPermissions: [USER_PERMISSIONS.LIST_ALL, USER_PERMISSIONS.LIST_STAFF],
      },
      {
        labelKey: 'roles',
        href: '/admin/roles',
        icon: Shield,
        permission: ROLE_PERMISSIONS.LIST_ALL,
      },
      {
        labelKey: 'permissionsDemo',
        href: '/admin/permissions-demo',
        icon: Code,
        permission: PERMISSION_PERMISSIONS.MANAGE_ALL,
      },
    ],
  },

  // Activity Section
  {
    titleKey: 'activity',
    icon: Activity,
    anyPermissions: [
      SESSION_PERMISSIONS.READ_ALL,
      SESSION_PERMISSIONS.READ_OWN,
      ACTIVITY_READ_PERMISSION,
    ],
    items: [
      {
        labelKey: 'activity',
        href: '/admin/activity',
        icon: Activity,
        permission: ACTIVITY_READ_PERMISSION,
      },
      {
        labelKey: 'sessions',
        href: '/sessions',
        icon: Activity,
        anyPermissions: [SESSION_PERMISSIONS.READ_ALL, SESSION_PERMISSIONS.READ_OWN],
      },
    ],
  },
];
