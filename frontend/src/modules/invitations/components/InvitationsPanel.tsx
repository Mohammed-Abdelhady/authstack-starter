'use client';
// Requires list filters, pagination, and row mutation state.

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getTextDirection } from '@/i18n/direction';
import { USER_PERMISSIONS } from '@app/core';
import { Description, Heading } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import { PaginationControl } from '@/components/pagination';
import { FormRootError } from '@/components/forms';
import { PermissionGuard } from '@/modules/permissions';
import { showsOwnRefusal } from '@/lib/refusal';
import { useAppSelector } from '@/store/hooks';
import { useListInvitationsQuery, useResendInvitationMutation } from '../api/invitationsApi';
import { INVITATION_PAGE_LIMIT, INVITATION_STATUSES } from '../constants/invitations';
import { useInvitationOperation } from '../hooks/useInvitationOperation';
import { invitationErrorKey } from '../utils/invitationErrors';
import type { InvitationStatus } from '../types/invitation.types';
import { FreshProofDialog } from './FreshProofDialog';
import { InvitationRow } from './InvitationRow';
import { InviteDialog } from './InviteDialog';

function InvitationsContent() {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const auth = useAppSelector((state) => state.auth);
  const [status, setStatus] = useState<InvitationStatus>('pending');
  const [page, setPage] = useState(1);
  const [resent, setResent] = useState(false);
  const query = useListInvitationsQuery({
    status,
    page,
    limit: INVITATION_PAGE_LIMIT,
    actorId: auth.user?.id,
    sessionGeneration: auth.sessionGeneration,
  });
  const [resend] = useResendInvitationMutation();
  const operation = useInvitationOperation();
  const pages = Math.max(1, query.currentData?.pages ?? page);
  if (!query.isFetching && !query.error && query.currentData?.page === page && page > pages)
    setPage(pages);
  const changeStatus = useCallback((value: string) => {
    if (INVITATION_STATUSES.some((item) => item === value)) {
      setStatus(value as InvitationStatus);
      setPage(1);
    }
  }, []);
  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);
  const succeeded = useCallback(() => setResent(true), []);
  const resendOne = useCallback(
    (id: string) => {
      setResent(false);
      const idempotencyKey = crypto.randomUUID();
      void operation.start({
        run: () => showsOwnRefusal(resend({ id, idempotencyKey })).unwrap(),
        onSuccess: succeeded,
      });
    },
    [operation, resend, succeeded],
  );
  const busy = operation.busy || operation.methods !== null;

  return (
    <section className="space-y-4" aria-label={t('title')} data-testid="invitations-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level={2} variant="sectionTitle">
          {t('title')}
        </Heading>
        <PermissionGuard permission={USER_PERMISSIONS.CREATE_ALL}>
          <InviteDialog />
        </PermissionGuard>
      </div>
      <div className="space-y-2">
        <Label htmlFor="invitation-status">{t('filter')}</Label>
        <Select
          value={status}
          onValueChange={changeStatus}
          busy={query.isFetching || busy}
          dir={getTextDirection(locale)}
        >
          <SelectTrigger
            id="invitation-status"
            className="w-full sm:w-48"
            data-testid="invitation-status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVITATION_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {t(`statuses.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <FormRootError
        error={operation.error ? t(`errors.${invitationErrorKey(operation.error)}`) : null}
      />
      {resent && <p role="status">{t('resent')}</p>}
      {query.isFetching ? (
        <LoadingRegion label={t('loading')} rows={3} />
      ) : query.error ? (
        <div role="alert" className="space-y-2">
          <p>{t(`errors.${invitationErrorKey(query.error)}`)}</p>
          <Button onClick={retry} data-testid="invitations-retry">
            {t('retry')}
          </Button>
        </div>
      ) : query.currentData ? (
        <>
          <p role="status">{t('count', { count: query.currentData.total })}</p>
          {query.currentData.invitations.length === 0 ? (
            <Description>{t('empty')}</Description>
          ) : (
            <ul className="space-y-3">
              {query.currentData.invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  busy={busy}
                  onResend={resendOne}
                />
              ))}
            </ul>
          )}
          <PaginationControl
            currentPage={page}
            totalPages={pages}
            onPageChange={setPage}
            isLoading={query.isFetching || busy}
          />
        </>
      ) : null}
      {operation.methods && (
        <FreshProofDialog
          methods={operation.methods}
          onProved={operation.proved}
          onCancel={operation.cancelProof}
        />
      )}
    </section>
  );
}

export function InvitationsPanel() {
  const auth = useAppSelector((state) => state.auth);
  return <InvitationsContent key={`${auth.user?.id}:${auth.sessionGeneration}`} />;
}
