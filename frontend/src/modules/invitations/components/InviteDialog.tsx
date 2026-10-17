'use client';
// Requires dialog visibility and in-flight dismissal control.

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getTextDirection } from '@/i18n/direction';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { InviteForm } from './InviteForm';

export function InviteDialog() {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={setOpen} busy={busy}>
      <DialogTrigger asChild>
        <Button data-testid="invitation-open-create">{t('invite')}</Button>
      </DialogTrigger>
      <DialogContent dir={getTextDirection(locale)} data-testid="invitation-create-dialog">
        <DialogHeader>
          <DialogTitle>{t('invite')}</DialogTitle>
          <DialogDescription>{t('inviteDescription')}</DialogDescription>
        </DialogHeader>
        <InviteForm onSuccess={close} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
