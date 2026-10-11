'use client';

import { useTranslations } from 'next-intl';
import { UserCard } from '@/modules/permissions/components/users/UserCard';
import { UserListSection } from '@/modules/permissions/components/users/UserListSection';
import type { AdminUser } from '@/modules/users/types';
import { cn } from '@/lib/utils';

export interface UserGroupedListProps {
  verifiedUsers: AdminUser[];
  pendingUsers: AdminUser[];
  collapsedSections: Set<string>;
  onToggleSection: (sectionId: string) => void;
  shouldAnimate: boolean;
  onManagePermissions: (userId: string, opener: HTMLElement | null) => void;
}

export function UserGroupedList({
  verifiedUsers,
  pendingUsers,
  collapsedSections,
  onToggleSection,
  shouldAnimate,
  onManagePermissions,
}: UserGroupedListProps) {
  const t = useTranslations('users');

  return (
    <div className="space-y-8">
      {verifiedUsers.length > 0 && (
        <UserListSection
          id="verified"
          title={t('verifiedUsers')}
          count={verifiedUsers.length}
          collapsed={collapsedSections.has('verified')}
          onCollapse={() => onToggleSection('verified')}
        >
          {verifiedUsers.map((user, index) => (
            <div
              key={user._id}
              className={cn(
                shouldAnimate && 'motion-safe:animate-slide-up motion-safe:stagger-animation',
              )}
              style={{ '--index': index } as React.CSSProperties}
            >
              <UserCard user={user} onManagePermissions={onManagePermissions} />
            </div>
          ))}
        </UserListSection>
      )}

      {pendingUsers.length > 0 && (
        <UserListSection
          id="pending"
          title={t('pendingVerification')}
          count={pendingUsers.length}
          collapsed={collapsedSections.has('pending')}
          onCollapse={() => onToggleSection('pending')}
        >
          {pendingUsers.map((user, index) => (
            <div
              key={user._id}
              className={cn(
                shouldAnimate && 'motion-safe:animate-slide-up motion-safe:stagger-animation',
              )}
              style={{ '--index': index } as React.CSSProperties}
            >
              <UserCard user={user} onManagePermissions={onManagePermissions} />
            </div>
          ))}
        </UserListSection>
      )}
    </div>
  );
}
