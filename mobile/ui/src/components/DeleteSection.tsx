import { StyleSheet, View } from 'react-native';
import { DELETION_TEST_ID, DELETION_VIEW } from '../constants/account-deletion';
import { useUi } from '../context/ui-context';
import { useAccountDeletion } from '../hooks/use-account-deletion';
import { erasureDate } from '../logic/account-deletion';
import { SIZE, SPACE } from '../theme/tokens';
import type { AccountDeletionProps } from '../types/account-deletion';
import { Button, BUTTON_VARIANT } from './Button';
import { Notice, NOTICE_TONE } from './Notice';
import { SkeletonGroup, SkeletonLine } from './Skeleton';
import { Description, Heading } from './Typography';

const styles = StyleSheet.create({ section: { gap: SPACE.LG } });

export function DeleteSection(props: AccountDeletionProps) {
  const { t, locale } = useUi();
  const section = useAccountDeletion(props);
  const date = erasureDate(locale, section.eraseAfter);
  const checking = section.view === DELETION_VIEW.CHECKING;
  return (
    <View testID={DELETION_TEST_ID.SECTION} style={styles.section}>
      <Heading level="section">{t('deletion.title')}</Heading>
      <Description>{t('deletion.description')}</Description>
      {section.notice === undefined ? null : (
        <Notice
          testID={DELETION_TEST_ID.NOTICE}
          tone={section.view === DELETION_VIEW.DELETED ? NOTICE_TONE.INFO : NOTICE_TONE.PROBLEM}
          title={t(section.notice)}
          description={date === undefined ? undefined : t('deletion.eraseAfter', { date })}
        />
      )}
      {checking ? (
        <View testID={DELETION_TEST_ID.BUSY}>
          <SkeletonGroup label={t('deletion.checking')}>
            <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
          </SkeletonGroup>
        </View>
      ) : null}
      {section.canDelete || section.view === DELETION_VIEW.DELETING ? (
        <Button
          testID={DELETION_TEST_ID.DELETE}
          label={t('deletion.delete')}
          variant={BUTTON_VARIANT.DANGER}
          stretch
          busy={section.view === DELETION_VIEW.DELETING}
          onPress={section.remove}
        />
      ) : null}
      {section.view === DELETION_VIEW.UNRESOLVED || section.view === DELETION_VIEW.STORAGE_ERROR ? (
        <Button
          testID={DELETION_TEST_ID.CHECK}
          label={t('deletion.checkAgain')}
          onPress={section.retry}
        />
      ) : null}
    </View>
  );
}
