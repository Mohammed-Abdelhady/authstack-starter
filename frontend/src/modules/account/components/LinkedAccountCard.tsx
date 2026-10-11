'use client';

import { Description, Heading } from '@/components/design-system';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { Loader2, CheckCircle2, Link as LinkIcon, Mail, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { OAuthProviderIcon } from '@/modules/oauth';
import { useUnlinkProviderMutation, useSetPrimaryProviderMutation } from '../api';
import {
  EMAIL_PROVIDER,
  EMAIL_SIGN_IN,
  PRIMARY_HINT,
  UNLINK_HINT,
  type EmailSignInHint,
  type PrimaryHint,
  type UnlinkHint,
} from '../types';
import { useSharedSingleFlight } from '@/hooks/useSingleFlight';

interface LinkedAccountCardProps {
  providerId: string;
  displayName: string;
  isPrimary: boolean;
  /** What the server says an unlink would be told. Without one, the server decides. */
  unlinkHint?: UnlinkHint;
  /** What the server says choosing this one as primary would be told. Without one, the server decides. */
  primaryHint?: PrimaryHint;
  /** On the email row: whether the address can sign in now. Without one, it is shown as connected. */
  emailSignIn?: EmailSignInHint;
  onChange?: () => void;
}

/**
 * LinkedAccountCard Component
 * One sign-in method with the actions to make it primary or unlink it
 */
export function LinkedAccountCard({
  providerId,
  displayName,
  isPrimary,
  unlinkHint,
  primaryHint,
  emailSignIn,
  onChange,
}: LinkedAccountCardProps) {
  const t = useTranslations('settings.accounts');
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const unlinkBlockedId = useId();
  const offersPrimary = !isPrimary && primaryHint !== PRIMARY_HINT.NO_PROFILE_TO_SYNC;
  const offersUnlink = unlinkHint !== UNLINK_HINT.NOT_REMOVABLE;
  const isUnlinkBlocked = unlinkHint === UNLINK_HINT.LAST_SIGN_IN_METHOD;
  const connectionKey = isPrimary ? 'primaryDescription' : 'linkedDescription';
  // The address stays on the account, but it is not shown as a way to sign in.
  const descriptionKey =
    emailSignIn === EMAIL_SIGN_IN.SWITCHED_OFF ? 'emailSignInSwitchedOff' : connectionKey;

  const [unlinkProvider, { isLoading: isUnlinking }] = useUnlinkProviderMutation();
  const [setPrimaryProvider, { isLoading: isSettingPrimary }] = useSetPrimaryProviderMutation();

  // Unlinking and choosing a primary change the same list, so they share one gate.
  const exclusive = useSharedSingleFlight();

  const unlink = async () => {
    try {
      await unlinkProvider(providerId).unwrap();
      toast.success(t('unlinkSuccess', { provider: displayName }));
      onChange?.();
      setShowUnlinkDialog(false);
    } catch (error) {
      // The hint was read before the refusal: read it again so the card says why.
      setShowUnlinkDialog(false);
      onChange?.();
      reportUnlessHandled(error);
    }
  };
  const handleUnlink = () => exclusive(unlink);

  const openUnlinkDialog = () => {
    if (!isUnlinkBlocked) {
      setShowUnlinkDialog(true);
    }
  };

  const setPrimary = async () => {
    try {
      await setPrimaryProvider({ provider: providerId }).unwrap();
      toast.success(t('setPrimarySuccess', { provider: displayName }));
      onChange?.();
    } catch (error) {
      reportUnlessHandled(error);
    }
  };
  const handleSetPrimary = () => exclusive(setPrimary);

  return (
    <>
      <Card className="overflow-hidden" data-testid={`linked-account-${providerId}`}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                {providerId === EMAIL_PROVIDER ? (
                  <Mail className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <OAuthProviderIcon
                    providerId={providerId}
                    displayName={displayName}
                    className="h-5 w-5"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Heading level={3} variant="subsectionTitle">
                    {displayName}
                  </Heading>
                  {isPrimary && (
                    <Badge variant="default" className="text-xs">
                      <CheckCircle2 className="me-1 h-3 w-3" />
                      {t('primary')}
                    </Badge>
                  )}
                </div>
                <Description data-testid={`linked-account-status-${providerId}`}>
                  {t(descriptionKey)}
                </Description>
              </div>
            </div>

            {(offersPrimary || offersUnlink) && (
              <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:shrink-0">
                {offersPrimary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetPrimary}
                    disabled={isSettingPrimary || isUnlinking}
                    className="w-full whitespace-nowrap lg:w-auto"
                    data-testid={`set-primary-${providerId}`}
                  >
                    {isSettingPrimary ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <>
                        <LinkIcon className="h-4 w-4 shrink-0" />
                        <span>{t('setPrimary')}</span>
                      </>
                    )}
                  </Button>
                )}

                {offersUnlink && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={openUnlinkDialog}
                    disabled={isUnlinking || isSettingPrimary}
                    // Focusable while blocked, so the reason is read out with it.
                    aria-disabled={isUnlinkBlocked || undefined}
                    aria-describedby={isUnlinkBlocked ? unlinkBlockedId : undefined}
                    className="w-full whitespace-nowrap lg:w-auto"
                    data-testid={`unlink-${providerId}`}
                  >
                    {isUnlinking ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <>
                        <Unlink className="h-4 w-4 shrink-0" />
                        <span>{t('unlink')}</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          {isUnlinkBlocked && (
            <Description
              id={unlinkBlockedId}
              className="mt-3"
              data-testid={`unlink-blocked-${providerId}`}
            >
              {t('unlinkBlockedLastSignInMethod')}
            </Description>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unlinkConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unlinkConfirmDescription', { provider: displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`unlink-cancel-${providerId}`}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlink}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`unlink-confirm-${providerId}`}
            >
              {t('confirmUnlink')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
