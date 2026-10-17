'use client';
// Requires list filters, pagination, and row mutation state.

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getTextDirection } from '@/i18n/direction';
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
import { usePermission } from '@/modules/permissions/hooks/usePermission';
import { showsOwnRefusal } from '@/lib/refusal';
import { useAppSelector } from '@/store/hooks';
import { useListInvitationsQuery, useResendInvitationMutation } from '../api/invitationsApi';
import { INVITATION_PAGE_LIMIT, INVITATION_STATUSES } from '../constants/invitations';
import { useInvitationOperation } from '../hooks/useInvitationOperation';
import { invitationErrorKey } from '../utils/invitationErrors';
import { invitationAccess } from '../utils/invitationAccess';
import type { InvitationStatus } from '../types/invitation.types';
import { FreshProofDialog } from './FreshProofDialog';
import { InvitationRow } from './InvitationRow';
import { InviteDialog } from './InviteDialog';

function useInvitationList() {
  const auth = useAppSelector((state) => state.auth);
  const { permissions } = usePermission();
  const { canCreate } = invitationAccess(permissions);
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
  const [resend, { isLoading: resending, originalArgs: resendArgs }] =
    useResendInvitationMutation();
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

  return {
    canCreate,
    status,
    page,
    setPage,
    resent,
    query,
    resending,
    resendArgs,
    operation,
    pages,
    changeStatus,
    retry,
    resendOne,
    busy,
  };
}

interface InvitationStatusFilterProps {
  status: InvitationStatus;
  busy: boolean;
  onChange: (value: string) => void;
}

function InvitationStatusFilter({ status, busy, onChange }: InvitationStatusFilterProps) {
  const t = useTranslations('invitations');
  const locale = useLocale();
  return (
    <div className="space-y-2">
      <Label htmlFor="invitation-status">{t('filter')}</Label>
      <Select value={status} onValueChange={onChange} busy={busy} dir={getTextDirection(locale)}>
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
  );
}

function InvitationResults({ model }: { model: ReturnType<typeof useInvitationList> }) {
  const t = useTranslations('invitations');
  return (
    <>
      {model.query.isFetching ? (
        <LoadingRegion label={t('loading')} rows={3} />
      ) : model.query.error ? (
        <div role="alert" className="space-y-2">
          <p>{t(`errors.${invitationErrorKey(model.query.error)}`)}</p>
          <Button onClick={model.retry} data-testid="invitations-retry">
            {t('retry')}
          </Button>
        </div>
      ) : model.query.currentData ? (
        <>
          <p role="status">{t('count', { count: model.query.currentData.total })}</p>
          {model.query.currentData.invitations.length === 0 ? (
            <Description>{t('empty')}</Description>
          ) : (
            <ul className="space-y-3">
              {model.query.currentData.invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  busy={model.busy}
                  resending={model.resending && model.resendArgs?.id === invitation.id}
                  onResend={model.resendOne}
                />
              ))}
            </ul>
          )}
          <PaginationControl
            currentPage={model.page}
            totalPages={model.pages}
            onPageChange={model.setPage}
            isLoading={model.query.isFetching || model.busy}
          />
        </>
      ) : null}
    </>
  );
}

function InvitationsContent() {
  const t = useTranslations('invitations');
  const model = useInvitationList();

  return (
    <section className="space-y-4" aria-label={t('title')} data-testid="invitations-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level={2} variant="sectionTitle">
          {t('title')}
        </Heading>
        {model.canCreate && <InviteDialog />}
      </div>
      <InvitationStatusFilter
        status={model.status}
        busy={model.query.isFetching || model.busy}
        onChange={model.changeStatus}
      />
      <FormRootError
        error={
          model.operation.error ? t(`errors.${invitationErrorKey(model.operation.error)}`) : null
        }
      />
      {model.resent && <p role="status">{t('resent')}</p>}
      <InvitationResults model={model} />
      {model.operation.methods && (
        <FreshProofDialog
          methods={model.operation.methods}
          onProved={model.operation.proved}
          onCancel={model.operation.cancelProof}
        />
      )}
    </section>
  );
}

export function InvitationsPanel() {
  const auth = useAppSelector((state) => state.auth);
  return <InvitationsContent key={`${auth.user?.id}:${auth.sessionGeneration}`} />;
}
