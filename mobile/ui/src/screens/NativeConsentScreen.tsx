import { useCallback } from 'react';
import type { NativeSafeAttemptView } from '@app/native-auth';
import { View } from 'react-native';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Field } from '../components/Field';
import { Description, Heading } from '../components/Typography';
import { NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import { isolateLtr } from '../logic/isolate';
import type { NativeFormActions } from '../types/native-sign-in';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

type ConsentView = Extract<NativeSafeAttemptView, { stage: 'consentRequired' }>;
export function NativeConsentScreen({
  view,
  pending,
  submit,
}: NativeFormActions & { view: ConsentView }) {
  const { t } = useUi();
  const title = useScreenTitleFocus();
  const accept = useCallback(() => submit({ kind: 'consent' }), [submit]);
  return (
    <View testID={NATIVE_UI_TEST_ID.CONSENT}>
      <Heading level="screen" nativeRef={title}>
        {t('native.consentTitle')}
      </Heading>
      <Description>{t('native.consentHint')}</Description>
      <Field name={t('native.name')} value={`\u2068${view.account.name}\u2069`} />
      <Field name={t('native.email')} value={isolateLtr(view.account.email)} />
      <Field name={t('native.application')} value={`\u2068${view.application.displayName}\u2069`} />
      <Field name={t('native.scopes')} value={view.application.scopes.map(isolateLtr).join(', ')} />
      {view.application.alreadyGranted ? <Description>{t('native.granted')}</Description> : null}
      <Button
        label={t('native.continue')}
        onPress={accept}
        busy={pending}
        stretch
        variant={BUTTON_VARIANT.PRIMARY}
        testID={NATIVE_UI_TEST_ID.CONSENT_ACCEPT}
      />
    </View>
  );
}
