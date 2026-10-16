'use client';
// Reads and clears the URL fragment, then spends the token only on activation.

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Heading, Description } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { FormRootError } from '@/components/forms';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { redirect } from '@/i18n/navigation';
import { useAppDispatch } from '@/store/hooks';
import { authApi } from '@/modules/auth/store/authApi';
import { showsOwnRefusal } from '@/lib/refusal';
import { useAcceptInvitationMutation } from '../api/invitationsApi';
import { INVITATION_DESTINATIONS } from '../constants/invitations';
import { useInvitationLink } from '../hooks/useInvitationLink';
import { invitationErrorKey } from '../utils/invitationErrors';

export function AcceptInvitationPanel() {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const dispatch = useAppDispatch();
  const [destination, setDestination] = useState<string | null>(null);
  const link = useInvitationLink();
  const [accept, { isLoading }] = useAcceptInvitationMutation();
  const [error, setError] = useState<unknown>(null);
  const [accepted, setAccepted] = useState(false);
  const invalid =
    link?.token === '' || (error !== null && invitationErrorKey(error) === 'invalidLink');
  const confirm = useSingleFlight(
    useCallback(async () => {
      if (!link?.token || invalid || accepted) return;
      setError(null);
      try {
        const result = await showsOwnRefusal(accept({ token: link.token })).unwrap();
        setAccepted(true);
        const destination = result.enrolment
          ? INVITATION_DESTINATIONS.enrolment
          : INVITATION_DESTINATIONS.dashboard;
        const runningIdentity = dispatch(
          authApi.util.getRunningQueryThunk('getIdentity', undefined),
        );
        if (runningIdentity) await runningIdentity;
        await dispatch(
          authApi.endpoints.getIdentity.initiate(undefined, {
            forceRefetch: true,
            subscribe: false,
          }),
        );
        setDestination(destination);
      } catch (failure) {
        setError(failure);
      }
    }, [accept, accepted, dispatch, invalid, link]),
  );

  if (destination) redirect({ href: destination, locale });

  return (
    <section className="space-y-4" data-testid="invitation-accept-panel">
      <Heading level={1} variant="pageTitle">
        {t('accept.title')}
      </Heading>
      {link === null ? (
        <p role="status">{t('loading')}</p>
      ) : invalid ? (
        <FormRootError error={t('errors.invalidLink')} />
      ) : (
        <>
          <Description>{t(`accept.purposes.${link.purpose}`)}</Description>
          <FormRootError error={error ? t(`errors.${invitationErrorKey(error)}`) : null} />
          {accepted && <p role="status">{t('accept.accepted')}</p>}
          <Button onClick={confirm} busy={isLoading || accepted} data-testid="invitation-accept">
            {t('accept.confirm')}
          </Button>
        </>
      )}
    </section>
  );
}
