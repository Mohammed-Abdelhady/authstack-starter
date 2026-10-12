import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Field } from '../components/Field';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { Screen, type Arrival } from '../components/Screen';
import { SkeletonGroup, SkeletonLine } from '../components/Skeleton';
import { Description, Heading } from '../components/Typography';
import { LIST_VIEW, SIGN_OUT_STATE, TEST_ID } from '../constants';
import { useUi } from '../context/ui-context';
import { useAccount } from '../hooks/use-account';
import { SIZE, SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  content: { gap: SPACE.XXL, flexGrow: 1 },
  group: { gap: SPACE.LG },
  intro: { gap: SPACE.SM },
  // Sign out stays at the foot of the screen, apart from the links above it.
  foot: { flexGrow: 1, justifyContent: 'flex-end', gap: SPACE.LG },
});

interface AccountScreenProps {
  arrival: Arrival;
  onOpenSessions: () => void;
}

function AccountSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
      <SkeletonLine width={SIZE.SKELETON_SHORT} height={SIZE.SKELETON_TITLE} />
      <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
      <SkeletonLine width={SIZE.SKELETON_SHORT} height={SIZE.SKELETON_LINE} />
    </SkeletonGroup>
  );
}

export function AccountScreen({ arrival, onOpenSessions }: AccountScreenProps) {
  const { t } = useUi();
  const { view, profile, failureText, sessionNotSaved, retry, signOut, signOutState } =
    useAccount();

  return (
    <Screen testID={TEST_ID.ACCOUNT_SCREEN} arrival={arrival}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Heading level="screen">{t('account.title')}</Heading>
          <Description>{t('account.description')}</Description>
        </View>
        {sessionNotSaved ? (
          <Notice
            title={t('account.storageWarning.title')}
            description={t('account.storageWarning.description')}
          />
        ) : null}
        {view === LIST_VIEW.LOADING ? <AccountSkeleton label={t('account.loading')} /> : null}
        {view === LIST_VIEW.ERROR ? (
          <View style={styles.group}>
            <Notice
              tone={NOTICE_TONE.PROBLEM}
              title={t('account.error.title')}
              description={failureText}
            />
            <Button testID={TEST_ID.ACCOUNT_RETRY} label={t('common.tryAgain')} onPress={retry} />
          </View>
        ) : null}
        {profile === undefined ? null : (
          <View style={styles.group}>
            <Field name={t('account.name')} value={profile.name} />
            <Field name={t('account.email')} value={profile.email} />
            <Field name={t('account.role')} value={profile.role} />
          </View>
        )}
        <View style={styles.group}>
          <View style={styles.intro}>
            <Heading level="section">{t('account.sessions.title')}</Heading>
            <Description>{t('account.sessions.description')}</Description>
          </View>
          <Button
            testID={TEST_ID.ACCOUNT_SESSIONS_LINK}
            label={t('account.sessions.action')}
            onPress={onOpenSessions}
          />
        </View>
        <View style={styles.foot}>
          {signOutState === SIGN_OUT_STATE.FAILED ? (
            <View style={styles.group}>
              <Notice
                testID={TEST_ID.ACCOUNT_NOTICE}
                tone={NOTICE_TONE.PROBLEM}
                title={t('account.signOutFailed.title')}
                description={t('account.signOutFailed.description')}
              />
              <Button
                testID={TEST_ID.ACCOUNT_SIGN_OUT_RETRY}
                label={t('common.tryAgain')}
                accessibilityHint={t('account.signOutHint')}
                onPress={signOut}
              />
            </View>
          ) : null}
          <Button
            testID={TEST_ID.ACCOUNT_SIGN_OUT}
            variant={BUTTON_VARIANT.DANGER}
            stretch
            label={t('account.signOut')}
            accessibilityHint={t('account.signOutHint')}
            busy={signOutState === SIGN_OUT_STATE.PENDING}
            onPress={signOut}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
