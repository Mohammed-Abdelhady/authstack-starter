import { NATIVE_AUTH_STAGE } from '@app/core';
import { useCallback } from 'react';
import { Button } from './Button';
import { NativeFormLayout } from './NativeFormLayout';
import { Description, Heading } from './Typography';
import { NativeCodeScreen } from '../screens/NativeCodeScreen';
import { NativeCredentialScreen } from '../screens/NativeCredentialScreen';
import { NativeConsentScreen } from '../screens/NativeConsentScreen';
import { NativeSecondFactorScreen } from '../screens/NativeSecondFactorScreen';
import { NATIVE_METHOD, NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import type { useNativeSignIn } from '../hooks/use-native-sign-in';
import { Notice, NOTICE_TONE } from './Notice';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

function EmailLinkSent({
  email,
  pending,
  resend,
}: {
  email: string;
  pending: boolean;
  resend(): void;
}) {
  const { t } = useUi();
  const title = useScreenTitleFocus();
  return (
    <>
      <Heading level="screen" nativeRef={title}>
        {t('native.emailSent')}
      </Heading>
      <Description>{t('native.emailSentHint', { email })}</Description>
      <Button
        label={t('native.resend')}
        onPress={resend}
        disabled={pending}
        testID={NATIVE_UI_TEST_ID.RESEND}
        stretch
      />
    </>
  );
}

export function NativeJourney({ flow }: { flow: ReturnType<typeof useNativeSignIn> }) {
  const { t } = useUi();
  const { view, method, pending, submit, choose, web, cancel } = flow;
  const retry = useCallback(() => {
    if (method) choose(method);
  }, [choose, method]);
  const resend = useCallback(() => {
    if (view?.stage === NATIVE_AUTH_STAGE.EMAIL_LINK_SENT)
      submit({ kind: 'requestEmailLink', email: view.email });
    else if (view?.stage === NATIVE_AUTH_STAGE.REGISTRATION_CODE_REQUIRED)
      choose(NATIVE_METHOD.REGISTRATION, view.email);
    else if (view?.stage === NATIVE_AUTH_STAGE.RECOVERY_CODE_REQUIRED)
      choose(NATIVE_METHOD.RECOVERY, view.email);
  }, [choose, submit, view]);
  const openBrowser = useCallback(() => web(), [web]);
  const actions = { pending, submit, web, cancel };
  const allowed =
    view?.stage === NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED &&
    method &&
    (method === NATIVE_METHOD.PASSWORD
      ? view.factors.includes('password')
      : method === NATIVE_METHOD.EMAIL_LINK
        ? view.factors.includes('emailLink')
        : true);
  return (
    <NativeFormLayout>
      {flow.message ? (
        <Notice
          title={t(flow.message)}
          tone={flow.problem ? NOTICE_TONE.PROBLEM : NOTICE_TONE.INFO}
          testID={NATIVE_UI_TEST_ID.NOTICE}
        />
      ) : null}
      {view?.stage === NATIVE_AUTH_STAGE.CONSENT_REQUIRED ? (
        <NativeConsentScreen view={view} {...actions} />
      ) : view?.stage === NATIVE_AUTH_STAGE.SECOND_FACTOR_REQUIRED ? (
        <NativeSecondFactorScreen
          key={`${view.attemptId}-${view.factors.join()}`}
          view={view}
          passkeyAvailable={flow.methods?.capabilities.passkeys === true}
          {...actions}
        />
      ) : view?.stage === NATIVE_AUTH_STAGE.REGISTRATION_CODE_REQUIRED ||
        view?.stage === NATIVE_AUTH_STAGE.RECOVERY_CODE_REQUIRED ? (
        <NativeCodeScreen
          key={`${view.attemptId}-${view.stage}`}
          view={view}
          {...actions}
          resend={resend}
        />
      ) : view?.stage === NATIVE_AUTH_STAGE.EMAIL_LINK_SENT ? (
        <EmailLinkSent email={view.email} pending={pending} resend={resend} />
      ) : allowed && method ? (
        <NativeCredentialScreen key={`${view.attemptId}-${method}`} method={method} {...actions} />
      ) : (
        <>
          <Description>{t(pending ? 'common.starting' : 'native.startAgain')}</Description>
          {method && !pending ? (
            <Button label={t('common.tryAgain')} onPress={retry} stretch />
          ) : null}
        </>
      )}
      {!allowed &&
      view?.stage !== NATIVE_AUTH_STAGE.REGISTRATION_CODE_REQUIRED &&
      view?.stage !== NATIVE_AUTH_STAGE.RECOVERY_CODE_REQUIRED ? (
        <Button
          label={t('signIn.action')}
          onPress={openBrowser}
          disabled={pending}
          testID={NATIVE_UI_TEST_ID.WEB}
          stretch
        />
      ) : null}
      <Button
        label={t('common.cancel')}
        onPress={cancel}
        testID={NATIVE_UI_TEST_ID.CANCEL}
        stretch
      />
    </NativeFormLayout>
  );
}
