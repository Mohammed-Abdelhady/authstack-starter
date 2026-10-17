'use client';

import { useTranslations } from 'next-intl';
import { AdminSessionsPanel } from '@/modules/admin-sessions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function UserSessionsDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations('adminSessions');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { user: userId })}</DialogDescription>
        </DialogHeader>
        {open ? <AdminSessionsPanel userId={userId} /> : null}
      </DialogContent>
    </Dialog>
  );
}
