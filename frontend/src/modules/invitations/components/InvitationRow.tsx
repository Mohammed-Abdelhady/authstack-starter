import { useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePermission } from '@/modules/permissions/hooks/usePermission';
import { invitationAccess } from '../utils/invitationAccess';
import type { AdminInvitation } from '../types/invitation.types';
import { RevokeInvitationDialog } from './RevokeInvitationDialog';

interface Props {
  invitation: AdminInvitation;
  busy: boolean;
  resending: boolean;
  onResend: (id: string) => void;
}

export function InvitationRow({ invitation, busy, resending, onResend }: Props) {
  const t = useTranslations('invitations');
  const format = useFormatter();
  const { permissions } = usePermission();
  const canManage = invitationAccess(permissions).canManage(invitation.audience);
  const resend = useCallback(() => onResend(invitation.id), [invitation.id, onResend]);
  const canRevoke = invitation.status === 'pending' || invitation.status === 'expired';
  return (
    <li className="space-y-3 rounded-md border p-4" data-testid={`invitation-${invitation.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
          <p>
            <bdi>{invitation.email}</bdi>
          </p>
          {invitation.name && (
            <p>
              <bdi>{invitation.name}</bdi>
            </p>
          )}
        </div>
        <Badge variant="secondary">{t(`statuses.${invitation.status}`)}</Badge>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t('role')}</dt>
          <dd>
            <bdi>{invitation.role}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('expiry')}</dt>
          <dd>
            <time dateTime={invitation.expiresAt}>
              {format.dateTime(new Date(invitation.expiresAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('invitedBy')}</dt>
          <dd>
            <bdi>{invitation.invitedBy || t('unknownInviter')}</bdi>
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {canRevoke && canManage && (
          <>
            <Button
              variant="outline"
              onClick={resend}
              busy={busy}
              aria-busy={resending}
              data-testid={`invitation-resend-${invitation.id}`}
            >
              {t('resend')}
            </Button>
            <RevokeInvitationDialog invitation={invitation} busy={busy} />
          </>
        )}
      </div>
    </li>
  );
}
