'use client';

import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import type { PasskeySummary } from '../types';
import { PasskeyRow } from './PasskeyRow';

interface PasskeyListProps {
  passkeys: PasskeySummary[] | undefined;
  isLoading: boolean;
  /** False only when the server said a removal would be refused. */
  canRemove: boolean;
  onRename: (passkey: PasskeySummary) => void;
  onDelete: (passkey: PasskeySummary) => void;
}

/** The passkeys on the account, newest first, as the backend returns them. */
export function PasskeyList({
  passkeys,
  isLoading,
  canRemove,
  onRename,
  onDelete,
}: PasskeyListProps) {
  const t = useTranslations('settings.passkeys');

  if (isLoading) {
    return <Skeleton className="h-20 w-full" data-testid="passkey-list-loading" />;
  }

  if (!passkeys || passkeys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="passkey-list-empty">
        {t('empty')}
      </p>
    );
  }

  return (
    <ul className="space-y-2" aria-label={t('listLabel')} data-testid="passkey-list">
      {passkeys.map((passkey) => (
        <PasskeyRow
          key={passkey.id}
          passkey={passkey}
          canRemove={canRemove}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}
