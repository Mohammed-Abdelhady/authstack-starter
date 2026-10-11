'use client';

import { Description, Heading } from '@/components/design-system';
import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck } from 'lucide-react';
import { ErrorCode } from '@app/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getInitials } from '@/lib/formatters';
import type { NativeAuthorizeAction } from './useNativeAuthorize';

interface NativeAuthorizeReadyViewProps {
  applicationName: string;
  accountName: string;
  accountEmail: string;
  /** The account below replaced the one shown before; say so before asking again. */
  accountChanged: boolean;
  action: NativeAuthorizeAction | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onApprove: () => void;
  onDeny: () => void;
  onNotYou: () => void;
}

/** The confirmation card: the account to check and the app on the phone. */
export function NativeAuthorizeReadyView({
  applicationName,
  accountName,
  accountEmail,
  accountChanged,
  action,
  headingRef,
  onApprove,
  onDeny,
  onNotYou,
}: NativeAuthorizeReadyViewProps) {
  const t = useTranslations('auth.nativeAuthorize');
  const tCodes = useTranslations('errors.codes');
  const busy = action !== null;

  return (
    <section className="mx-auto mt-12 w-full max-w-sm" data-testid="native-authorize-ready">
      {accountChanged && (
        <Alert variant="warning" className="mb-4" data-testid="native-authorize-account-changed">
          <AlertDescription>{tCodes(ErrorCode.NATIVE_AUTHORIZE_ACCOUNT_MISMATCH)}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-secondary text-primary text-sm font-medium">
            {getInitials(accountName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{accountName}</p>
          <p className="truncate text-sm text-muted-foreground">
            <span dir="ltr" data-testid="native-authorize-account-email">
              {accountEmail}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="link"
          onClick={onNotYou}
          busy={busy}
          className="h-11 shrink-0 px-2"
          data-testid="native-authorize-not-you"
        >
          {t('notYou')}
        </Button>
      </div>

      <Heading level={1} variant="display" ref={headingRef} tabIndex={-1} className="mt-6">
        {t('title', { application: applicationName })}
      </Heading>
      <Description variant="lead" className="mt-2">
        {t('accountStatement')}
      </Description>

      <div className="mt-6 space-y-3">
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={onApprove}
          busy={busy}
          aria-busy={action === 'approve'}
          data-testid="native-authorize-approve"
        >
          {action === 'approve' ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          )}
          {t('approve')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={onDeny}
          busy={busy}
          aria-busy={action === 'deny'}
          data-testid="native-authorize-deny"
        >
          {action === 'deny' && (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          )}
          {t('deny')}
        </Button>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">{t('returnNote')}</p>
    </section>
  );
}
