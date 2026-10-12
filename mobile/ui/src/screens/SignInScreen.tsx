import { StyleSheet, View } from 'react-native';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Description, Heading } from '../components/Typography';
import { TEST_ID } from '../constants';
import { useUi } from '../context/ui-context';
import { useSignIn } from '../hooks/use-sign-in';
import { SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  // The title opens the screen where the account title will be. The action stays under the thumb.
  content: { flex: 1, justifyContent: 'space-between', gap: SPACE.XL },
  intro: { gap: SPACE.SM },
  action: { gap: SPACE.XL },
});

export function SignInScreen() {
  const { t, appName } = useUi();
  const { canAct, actionLabel, notice, act } = useSignIn();

  return (
    <Screen testID={TEST_ID.SIGN_IN_SCREEN}>
      <View style={styles.content}>
        <View style={styles.intro}>
          <Heading level="screen">{t('signIn.title', { appName })}</Heading>
          <Description>{t('signIn.description')}</Description>
        </View>
        <View style={styles.action}>
          {notice === undefined ? null : (
            <Notice
              testID={TEST_ID.SIGN_IN_NOTICE}
              title={notice.title}
              description={notice.description}
              tone={notice.problem ? NOTICE_TONE.PROBLEM : NOTICE_TONE.INFO}
            />
          )}
          <Button
            testID={TEST_ID.SIGN_IN_ACTION}
            variant={BUTTON_VARIANT.PRIMARY}
            stretch
            label={actionLabel}
            accessibilityHint={t('signIn.actionHint')}
            busy={!canAct}
            onPress={act}
          />
        </View>
      </View>
    </Screen>
  );
}
