import { NATIVE_AUTH_STAGE } from '@app/core';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { NATIVE_AUTH_FLOW } from '@app/core';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { NativeJourney } from '../components/NativeJourney';
import { NativeMethodChoices } from '../components/NativeMethodChoices';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Description, Heading } from '../components/Typography';
import { TEST_ID } from '../constants';
import { NATIVE_DISCOVERY, NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import { useSignIn } from '../hooks/use-sign-in';
import { useNativeSignIn } from '../hooks/use-native-sign-in';
import { SPACE } from '../theme/tokens';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: SPACE.XL },
  intro: { gap: SPACE.SM },
  action: { gap: SPACE.MD },
});

function SignInIntro() {
  const { t, appName } = useUi();
  const title = useScreenTitleFocus();
  return (
    <View style={styles.intro}>
      <Heading level="screen" nativeRef={title}>
        {t('signIn.title', { appName })}
      </Heading>
      <Description>{t('native.description')}</Description>
    </View>
  );
}

export function SignInScreen() {
  const { t, providerButton } = useUi();
  const { canAct, actionLabel, notice, act } = useSignIn();
  const flow = useNativeSignIn();
  const providerWeb = useCallback(
    (providerId: string) => flow.web(NATIVE_AUTH_FLOW.SIGN_IN, providerId),
    [flow.web],
  );
  if (flow.method || (flow.view && flow.view.stage !== NATIVE_AUTH_STAGE.FIRST_FACTOR_REQUIRED))
    return <NativeJourney flow={flow} />;
  const disabled = !canAct || flow.pending;
  const noMethods =
    flow.methods &&
    !Object.values(flow.methods.capabilities).some(Boolean) &&
    flow.methods.providers.length === 0;
  return (
    <Screen testID={TEST_ID.SIGN_IN_SCREEN}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SignInIntro />
        <View style={styles.action}>
          {notice === undefined ? null : (
            <Notice
              testID={TEST_ID.SIGN_IN_NOTICE}
              title={notice.title}
              description={notice.description}
              tone={notice.problem ? NOTICE_TONE.PROBLEM : NOTICE_TONE.INFO}
            />
          )}
          {flow.message ? (
            <Notice
              testID={NATIVE_UI_TEST_ID.NOTICE}
              title={t(flow.message)}
              tone={flow.problem ? NOTICE_TONE.PROBLEM : NOTICE_TONE.INFO}
            />
          ) : null}
          {flow.discovery === NATIVE_DISCOVERY.LOADING ? (
            <Description>{t('native.loading')}</Description>
          ) : null}
          {flow.discovery === NATIVE_DISCOVERY.FAILED ? (
            <>
              <Notice
                testID={NATIVE_UI_TEST_ID.METHODS_NOTICE}
                title={t('native.methodsFailed')}
                description={t('native.methodsFailedHint')}
                tone={NOTICE_TONE.PROBLEM}
              />
            </>
          ) : null}
          {flow.discovery !== NATIVE_DISCOVERY.FAILED && flow.methods?.nativeEnabled === false ? (
            <Notice
              title={t('signIn.failed.disabled')}
              testID={NATIVE_UI_TEST_ID.METHODS_NOTICE}
              tone={NOTICE_TONE.PROBLEM}
            />
          ) : flow.discovery !== NATIVE_DISCOVERY.FAILED && noMethods ? (
            <Notice title={t('native.empty')} testID={NATIVE_UI_TEST_ID.METHODS_NOTICE} />
          ) : null}
          {flow.discovery === NATIVE_DISCOVERY.FAILED ||
          (flow.discovery === NATIVE_DISCOVERY.READY &&
            (flow.methods?.nativeEnabled === false || noMethods)) ? (
            <Button
              label={t('common.tryAgain')}
              onPress={flow.load}
              disabled={disabled}
              testID={NATIVE_UI_TEST_ID.METHODS_RETRY}
              stretch
            />
          ) : null}
          {flow.methods ? (
            <NativeMethodChoices
              methods={flow.methods}
              disabled={disabled || flow.discovery !== NATIVE_DISCOVERY.READY}
              pendingFactor={flow.pendingFactor}
              providerButton={providerButton}
              choose={flow.choose}
              startFactor={flow.startFactor}
              providerWeb={providerWeb}
            />
          ) : null}
          {flow.pending || flow.view ? (
            <Button
              label={t('common.cancel')}
              onPress={flow.cancel}
              testID={NATIVE_UI_TEST_ID.CANCEL}
              stretch
            />
          ) : null}
          <Button
            testID={TEST_ID.SIGN_IN_ACTION}
            variant={BUTTON_VARIANT.SECONDARY}
            stretch
            label={actionLabel}
            accessibilityHint={t('signIn.actionHint')}
            busy={!canAct}
            disabled={flow.pending || flow.methods?.nativeEnabled === false}
            onPress={act}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
