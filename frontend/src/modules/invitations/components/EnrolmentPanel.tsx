'use client';
// Uses the enrollment cookie only for the passkey registration ceremony.
import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Heading, Description } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { FormRootError } from '@/components/forms';
import { PasskeyRegistrationProofForm } from '@/modules/passkeys/components/PasskeyRegistrationProofForm';
import type { PasskeyRegistrationProof } from '@/modules/passkeys/types';
import { useRegisterPasskey } from '@/modules/passkeys/hooks/useRegisterPasskey';
import { redirect } from '@/i18n/navigation';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useAppDispatch } from '@/store/hooks';
import { authApi } from '@/modules/auth/store/authApi';
import { INVITATION_DESTINATIONS } from '../constants/invitations';

export function EnrolmentPanel() {
  const t = useTranslations('invitations');
  const locale = useLocale();
  const dispatch = useAppDispatch();
  const { register, isBusy, isCooling, error, requiredProof } = useRegisterPasskey();
  const [proof, setProof] = useState<PasskeyRegistrationProof>({});
  const [registered, setRegistered] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [identityFailed, setIdentityFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const enrol = useSingleFlight(
    useCallback(async () => {
      if (!registered) {
        const created = await register(proof);
        if (!created) return;
        setRegistered(true);
      }
      setContinuing(true);
      setIdentityFailed(false);
      const identity = await dispatch(
        authApi.endpoints.getIdentity.initiate(undefined, {
          forceRefetch: true,
          subscribe: false,
        }),
      );
      if (identity.data?.authenticated) setReady(true);
      else setIdentityFailed(true);
      setContinuing(false);
    }, [dispatch, proof, register, registered]),
  );
  if (ready) redirect({ href: INVITATION_DESTINATIONS.dashboard, locale });
  return (
    <section className="space-y-4" data-testid="invitation-enrolment-panel">
      <Heading level={1} variant="pageTitle">
        {t('enrolment.title')}
      </Heading>
      <Description>{t('enrolment.description')}</Description>
      <FormRootError error={identityFailed ? t('enrolment.identityFailed') : error} />
      {requiredProof !== null && !registered ? (
        <PasskeyRegistrationProofForm
          requirement={requiredProof}
          proof={proof}
          error={error}
          isBusy={isBusy}
          isCooling={isCooling}
          onProofChange={setProof}
          onSubmit={enrol}
        />
      ) : (
        <Button
          onClick={enrol}
          busy={isBusy || continuing}
          aria-busy={isBusy || continuing}
          disabled={isCooling}
          data-testid="invitation-enrolment-register"
        >
          {t(registered ? 'enrolment.continue' : 'enrolment.register')}
        </Button>
      )}
    </section>
  );
}
