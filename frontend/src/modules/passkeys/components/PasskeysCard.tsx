'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthMethodsLoadErrorCard } from '@/modules/auth/components/AuthMethodsLoadError';
import { useAuthMethods } from '@/modules/auth/hooks/useAuthMethods';
import { useGetPasskeysQuery } from '../api';
import type { PasskeyRegistrationProof } from '../types';
import {
  useDialogTarget,
  usePasskeySupport,
  usePlatformAuthenticator,
  useRegisterPasskey,
} from '../hooks';
import {
  PASSKEY_NAME_MODE,
  PASSKEY_SUPPORT,
  type PasskeyNameTarget,
  type PasskeySummary,
} from '../types';
import { PasskeyDeleteDialog } from './PasskeyDeleteDialog';
import { PasskeyList } from './PasskeyList';
import { PasskeyNameDialog } from './PasskeyNameDialog';
import { PasskeyPrompt } from './PasskeyPrompt';
import { PasskeyRegistrationProofForm } from './PasskeyRegistrationProofForm';

/**
 * Passkey settings.
 *
 * The card disappears where the deployment turned passkeys off, which is also
 * where every route behind it answers FEATURE_DISABLED. Not knowing whether
 * it is off is a failure with a retry, not a card that is gone.
 */
export function PasskeysCard() {
  const t = useTranslations('settings.passkeys');
  const tAuth = useTranslations('auth.passkeys');
  const {
    methods,
    isLoading: isLoadingMethods,
    isError: methodsFailed,
    retry,
    hasRetried,
  } = useAuthMethods();
  const isOn = methods?.passkeys === true;
  const { data: listed, isLoading: isLoadingList } = useGetPasskeysQuery(undefined, {
    skip: !isOn,
  });
  const support = usePasskeySupport();
  const hasPlatformAuthenticator = usePlatformAuthenticator();
  const { register, isBusy, isCooling, error, requiredProof } = useRegisterPasskey();
  const [registrationProof, setRegistrationProof] = useState<PasskeyRegistrationProof>({});
  const naming = useDialogTarget<PasskeyNameTarget>();
  const removing = useDialogTarget<PasskeySummary>();
  // Takes focus once a passkey is removed: its row and buttons are gone.
  const titleRef = useRef<HTMLParagraphElement>(null);

  const openNaming = naming.open;
  const onAdd = useCallback(async () => {
    const created = await register(registrationProof);
    if (created) {
      setRegistrationProof({});
      openNaming({ passkey: created, mode: PASSKEY_NAME_MODE.CREATE });
    }
  }, [openNaming, register, registrationProof]);

  const onRename = useCallback(
    (passkey: PasskeySummary) => openNaming({ passkey, mode: PASSKEY_NAME_MODE.RENAME }),
    [openNaming],
  );

  if (isLoadingMethods) {
    return <Skeleton className="h-48 w-full" data-testid="passkeys-card-loading" />;
  }

  if (methodsFailed) {
    return (
      <AuthMethodsLoadErrorCard
        title={t('title')}
        onRetry={retry}
        takeFocus={hasRetried}
        testId="passkeys-card-error"
      />
    );
  }

  if (!isOn) {
    return null;
  }

  const passkeys = listed?.passkeys;
  const count = passkeys?.length ?? 0;

  return (
    <Card data-testid="passkeys-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle ref={titleRef} tabIndex={-1}>
            {t('title')}
          </CardTitle>
          <Badge variant={count > 0 ? 'success' : 'secondary'} data-testid="passkeys-count-badge">
            {t('count', { count })}
          </Badge>
        </div>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <PasskeyList
          passkeys={passkeys}
          canRemove={listed?.canRemove !== false}
          isLoading={isLoadingList}
          onRename={onRename}
          onDelete={removing.open}
        />

        {support === PASSKEY_SUPPORT.UNSUPPORTED ? (
          <p className="text-sm text-muted-foreground" data-testid="passkeys-unsupported">
            {tAuth('unsupported')}
          </p>
        ) : (
          <>
            {requiredProof !== null ? (
              <PasskeyRegistrationProofForm
                requirement={requiredProof}
                proof={registrationProof}
                error={error}
                isBusy={isBusy}
                isCooling={isCooling}
                onProofChange={setRegistrationProof}
                onSubmit={onAdd}
              />
            ) : (
              <PasskeyPrompt
                label={t('add')}
                error={error}
                isBusy={isBusy}
                onRun={onAdd}
                icon={Plus}
                className="max-w-none"
                testId="passkey-add"
              />
            )}
            {hasPlatformAuthenticator === false && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="passkey-no-platform-authenticator"
              >
                {t('noPlatformAuthenticator')}
              </p>
            )}
          </>
        )}
      </CardContent>

      <PasskeyNameDialog open={naming.isOpen} target={naming.target} onClose={naming.close} />
      <PasskeyDeleteDialog
        open={removing.isOpen}
        passkey={removing.target}
        onClose={removing.close}
        landing={titleRef}
      />
    </Card>
  );
}
