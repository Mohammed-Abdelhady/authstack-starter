import type { PasskeyActions } from '@app/native-auth';
import { StyleSheet, View } from 'react-native';
import { BUTTON_VARIANT } from '../constants/button';
import { PASSKEYS_TEST_ID, PASSKEYS_VIEW } from '../constants/passkeys';
import { useUi } from '../context/ui-context';
import { usePasskeys } from '../hooks/use-passkeys';
import { SIZE, SPACE } from '../theme/tokens';
import { Button } from './Button';
import { Notice, NOTICE_TONE } from './Notice';
import { PasskeyRow } from './PasskeyRow';
import { SkeletonGroup, SkeletonLine } from './Skeleton';
import { Description, Heading } from './Typography';

const styles = StyleSheet.create({
  section: { gap: SPACE.LG },
  intro: { gap: SPACE.SM },
  list: { gap: SPACE.MD },
});

interface PasskeysSectionProps {
  /** `engine.passkeys` of the signed-in engine. */
  passkeys: PasskeyActions;
  /** Sends the person through sign-in when adding a passkey asks for a fresh one. */
  onSignInAgain?: () => void;
}

/** The account's passkeys: list, add, rename and remove. */
export function PasskeysSection({ passkeys, onSignInAgain }: PasskeysSectionProps) {
  const { t } = useUi();
  const section = usePasskeys(passkeys);
  const { view, notice } = section;

  return (
    <View style={styles.section} testID={PASSKEYS_TEST_ID.SECTION}>
      <View style={styles.intro}>
        <Heading level="section">{t('passkeys.title')}</Heading>
        <Description>{t('passkeys.description')}</Description>
      </View>
      {notice === undefined ? null : (
        <Notice
          testID={PASSKEYS_TEST_ID.NOTICE}
          tone={notice.tone}
          title={notice.title}
          description={notice.description}
        />
      )}
      {notice?.signInAgain && onSignInAgain ? (
        <Button
          testID={PASSKEYS_TEST_ID.SIGN_IN_AGAIN}
          label={t('passkeys.signInAgain.action')}
          onPress={onSignInAgain}
        />
      ) : null}
      {view === PASSKEYS_VIEW.LOADING ? (
        <SkeletonGroup label={t('passkeys.loading')}>
          <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
          <SkeletonLine width={SIZE.SKELETON_SHORT} height={SIZE.SKELETON_LINE} />
        </SkeletonGroup>
      ) : null}
      {view === PASSKEYS_VIEW.ERROR ? (
        <>
          <Notice
            tone={NOTICE_TONE.PROBLEM}
            title={t('passkeys.error.title')}
            description={section.failure}
          />
          <Button
            testID={PASSKEYS_TEST_ID.RETRY}
            label={t('passkeys.retry')}
            onPress={section.reload}
          />
        </>
      ) : null}
      {view === PASSKEYS_VIEW.EMPTY ? (
        <Notice title={t('passkeys.empty.title')} description={t('passkeys.empty.description')} />
      ) : null}
      {section.refreshFailed ? (
        <Notice
          tone={NOTICE_TONE.PROBLEM}
          title={t('passkeys.error.title')}
          description={section.failure}
        />
      ) : null}
      {view === PASSKEYS_VIEW.READY ? (
        <View style={styles.list}>
          {section.passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              busy={section.busyRows.has(passkey.id)}
              onRename={section.rename}
              onRemove={section.remove}
            />
          ))}
        </View>
      ) : null}
      {view === PASSKEYS_VIEW.LOADING || view === PASSKEYS_VIEW.ERROR ? null : (
        <Button
          testID={PASSKEYS_TEST_ID.ADD}
          variant={BUTTON_VARIANT.PRIMARY}
          stretch
          label={t('passkeys.add')}
          busy={section.adding}
          onPress={section.add}
        />
      )}
    </View>
  );
}
