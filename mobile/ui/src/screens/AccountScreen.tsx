import type { PasskeyActions } from '@app/native-auth'; // feature:passkeys
import type { ProviderSignInPort } from '@app/native-auth'; // feature:oauth-core
import type { AccountDeletionProps } from '../types/account-deletion';
import { PasskeysSection } from '../components/PasskeysSection'; // feature:passkeys
import { ProvidersSection } from '../components/ProvidersSection'; // feature:oauth-core
import { DeleteSection } from '../components/DeleteSection';
import { EmailSection } from '../components/EmailSection';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Field } from '../components/Field';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { Screen, type Arrival } from '../components/Screen';
import { Surface } from '../components/Surface';
import { SkeletonGroup, SkeletonLine } from '../components/Skeleton';
import { Description, Heading } from '../components/Typography';
import { LIST_VIEW, SIGN_OUT_STATE, TEST_ID } from '../constants';
import { useUi } from '../context/ui-context';
import { useAccount } from '../hooks/use-account';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';
import { SIZE, SPACE } from '../theme/tokens';

const styles = StyleSheet.create({
  content: { gap: SPACE.XXL, flexGrow: 1 },
  group: { gap: SPACE.LG },
  intro: { gap: SPACE.SM },
  // Sign out stays at the foot of the screen, apart from the links above it.
  foot: { flexGrow: 1, justifyContent: 'flex-end', gap: SPACE.LG },
});

interface AccountScreenProps {
  passkeys?: PasskeyActions; // feature:passkeys
  providerSignIn?: ProviderSignInPort; // feature:oauth-core
  accountDeletion?: AccountDeletionProps;
  onSignInAgain?: () => void;
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

export function AccountScreen({
  arrival,
  onOpenSessions,
  accountDeletion,
  onSignInAgain,
  passkeys, // feature:passkeys
  providerSignIn, // feature:oauth-core
}: AccountScreenProps) {
  const { t } = useUi();
  const titleRef = useScreenTitleFocus();
  const { view, profile, failureText, sessionNotSaved, retry, signOut, signOutState } =
    useAccount();

  return (
    <Screen testID={TEST_ID.ACCOUNT_SCREEN} arrival={arrival}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Heading level="screen" nativeRef={titleRef}>
            {t('account.title')}
          </Heading>
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
          <Surface>
            <Field name={t('account.name')} value={profile.name} />
            <Field name={t('account.email')} value={profile.email} />
            <Field name={t('account.role')} value={profile.role} />
          </Surface>
        )}
        <Surface>
          <View style={styles.intro}>
            <Heading level="section">{t('account.sessions.title')}</Heading>
            <Description>{t('account.sessions.description')}</Description>
          </View>
          <Button
            testID={TEST_ID.ACCOUNT_SESSIONS_LINK}
            label={t('account.sessions.action')}
            onPress={onOpenSessions}
          />
        </Surface>
        {profile === undefined ? null : (
          <>
            <EmailSection />
            {/* feature:passkeys:start */}
            {passkeys ? (
              <PasskeysSection passkeys={passkeys} onSignInAgain={onSignInAgain} />
            ) : null}
            {/* feature:passkeys:end */}
            {/* feature:oauth-core:start */}
            <ProvidersSection providerSignIn={providerSignIn} onSignInAgain={onSignInAgain} />
            {/* feature:oauth-core:end */}
            {accountDeletion ? <DeleteSection {...accountDeletion} /> : null}
          </>
        )}
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
