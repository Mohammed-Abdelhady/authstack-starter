import { NATIVE_AUTH_FIRST_FACTOR, NATIVE_AUTH_STAGE } from '@app/core';
import type { NativeFirstFactor } from '@app/sdk';
import { useCallback } from 'react';
import { Button } from './Button';
import { NativeFormLayout } from './NativeFormLayout';
import { Description, Heading } from './Typography';
import { NativeCodeScreen } from '../screens/NativeCodeScreen';
import { NativeEmailCodeScreen } from '../screens/NativeCodeScreen'; // feature:email-code
import { NativeCredentialScreen } from '../screens/NativeCredentialScreen';
import { NativeConsentScreen } from '../screens/NativeConsentScreen';
import { NativeSecondFactorScreen } from '../screens/NativeSecondFactorScreen';
import { NATIVE_METHOD, NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { NATIVE_DISCOVERY } from '../constants/native-sign-in'; // feature:email-code
import { useUi } from '../context/ui-context';
import type { useNativeSignIn } from '../hooks/use-native-sign-in';
import type { NativeUiMethod } from '../types/native-sign-in';
import { Notice, NOTICE_TONE } from './Notice';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

/** The attempt factor a sign-in method needs. Sign-up and recovery start flows of their own. */
const METHOD_FACTOR: Partial<Record<NativeUiMethod, NativeFirstFactor>> = {
  [NATIVE_METHOD.PASSWORD]: NATIVE_AUTH_FIRST_FACTOR.PASSWORD,
  [NATIVE_METHOD.EMAIL_LINK]: NATIVE_AUTH_FIRST_FACTOR.EMAIL_LINK,
  [NATIVE_METHOD.EMAIL_CODE]: NATIVE_AUTH_FIRST_FACTOR.EMAIL_CODE, // feature:email-code
};

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
      <Heading level="screen" variant="display" nativeRef={title}>
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

// feature:email-code:start
/** Shown until the methods reply says whether the attempt waits for a code or a link. */
function EmailMethodsPending({ failed, retry }: { failed: boolean; retry(): void }) {
  const { t } = useUi();
  if (!failed) return <Description>{t('native.loading')}</Description>;
  return (
    <>
      <Notice
        title={t('native.methodsFailed')}
        description={t('native.methodsFailedHint')}
        tone={NOTICE_TONE.PROBLEM}
        testID={NATIVE_UI_TEST_ID.METHODS_NOTICE}
      />
      <Button
        label={t('common.tryAgain')}
        onPress={retry}
        testID={NATIVE_UI_TEST_ID.METHODS_RETRY}
        stretch
      />
    </>
  );
}
// feature:email-code:end

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
  const factor = method && METHOD_FACTOR[method];
  const allowed =
    view?.stage === NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED &&
    method &&
    (factor === undefined || view.factors.includes(factor));
  // feature:email-code:start
  const codeSent =
    view?.stage === NATIVE_AUTH_STAGE.EMAIL_LINK_SENT &&
    flow.methods?.capabilities.emailCode === true;
  const codeLink = flow.methods?.capabilities.emailLink === true;
  // The link screen's resend would mail a link alone and void a code already mailed.
  const methodsPending =
    view?.stage === NATIVE_AUTH_STAGE.EMAIL_LINK_SENT && flow.discovery !== NATIVE_DISCOVERY.READY;
  const methodsFailed = flow.discovery === NATIVE_DISCOVERY.FAILED;
  // feature:email-code:end
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
      ) : methodsPending ? ( // feature:email-code
        <EmailMethodsPending failed={methodsFailed} retry={flow.load} /> // feature:email-code
      ) : codeSent ? ( // feature:email-code
        <NativeEmailCodeScreen key={view.attemptId} view={view} withLink={codeLink} {...actions} /> // feature:email-code
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
