'use client';
// Requires localized tab controls and mounts each view when selected.

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getTextDirection } from '@/i18n/direction';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermission } from '@/modules/permissions/hooks/usePermission';
import { Heading } from '@/components/design-system';
import { invitationAccess } from '../utils/invitationAccess';
import { InvitationsPanel } from './InvitationsPanel';

export function UsersInvitationTabs({ children }: { children: ReactNode }) {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const { permissions } = usePermission();
  const { canList } = invitationAccess(permissions);
  if (!canList) return <>{children}</>;
  return (
    <Tabs defaultValue="users" dir={getTextDirection(locale)}>
      <div className="container max-w-7xl px-4 pt-8">
        <TabsList aria-label={t('views')}>
          <TabsTrigger value="users" data-testid="admin-users-view">
            {t('usersView')}
          </TabsTrigger>
          <TabsTrigger value="invitations" data-testid="admin-invitations-view">
            {t('title')}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="users">{children}</TabsContent>
      <TabsContent value="invitations" className="container max-w-7xl space-y-6 px-4 py-8">
        <Heading level={1} variant="pageTitle">
          {t('title')}
        </Heading>
        <InvitationsPanel />
      </TabsContent>
    </Tabs>
  );
}
