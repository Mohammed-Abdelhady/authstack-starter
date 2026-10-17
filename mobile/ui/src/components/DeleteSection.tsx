import { StyleSheet, View } from 'react-native';
import { DELETION_TEST_ID, DELETION_VIEW } from '../constants/account-deletion';
import { EMAIL_CODE_LENGTH } from '../constants/email-change';
import { useUi } from '../context/ui-context';
import { useAccountDeletion } from '../hooks/use-account-deletion';
import { erasureDate } from '../logic/account-deletion';
import { SIZE, SPACE } from '../theme/tokens';
import type { AccountDeletionProps } from '../types/account-deletion';
import { Button, BUTTON_VARIANT } from './Button';
import { Notice, NOTICE_TONE } from './Notice';
import { SkeletonGroup, SkeletonLine } from './Skeleton';
import { TextField } from './TextField';
import { Description, Heading } from './Typography';

const styles = StyleSheet.create({ section: { gap: SPACE.LG } });

function DeletionProofFields({ proof }: { proof: ReturnType<typeof useAccountDeletion>['proof'] }) {
  const { t } = useUi();
  if (!proof.open) return null;
  return (
    <View style={styles.section}>
      <Description>{t('deletion.proofSent')}</Description>
      {proof.notice && <Notice tone={NOTICE_TONE.PROBLEM} title={t(proof.notice)} />}
      <TextField
        testID={DELETION_TEST_ID.PROOF_CODE}
        label={t('email.code')}
        value={proof.code}
        onChangeText={proof.setCode}
        onSubmitEditing={proof.submit}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        latin
        maxLength={EMAIL_CODE_LENGTH}
        disabled={proof.busy}
      />
      <Button
        testID={DELETION_TEST_ID.PROOF_CONFIRM}
        label={t('email.confirm')}
        onPress={proof.submit}
        busy={proof.busy}
        disabled={!proof.valid}
      />
      <Button
        testID={DELETION_TEST_ID.PROOF_RESEND}
        label={t('deletion.proofResend')}
        onPress={proof.resend}
        busy={proof.busy}
        variant={BUTTON_VARIANT.OUTLINE}
      />
      <Button
        testID={DELETION_TEST_ID.PROOF_CANCEL}
        label={t('common.cancel')}
        onPress={proof.cancel}
        busy={proof.busy}
        variant={BUTTON_VARIANT.LINK}
      />
    </View>
  );
}

function hideRecoveryOnly(
  recoveryOnly: boolean | undefined,
  view: ReturnType<typeof useAccountDeletion>['view'],
) {
  return (
    Boolean(recoveryOnly) &&
    (view === DELETION_VIEW.CHECKING ||
      view === DELETION_VIEW.READY ||
      view === DELETION_VIEW.DELETED)
  );
}

export function DeleteSection(props: AccountDeletionProps & { recoveryOnly?: boolean }) {
  const { t, locale } = useUi();
  const section = useAccountDeletion(props);
  const date = erasureDate(locale, section.eraseAfter);
  const checking = section.view === DELETION_VIEW.CHECKING;
  if (hideRecoveryOnly(props.recoveryOnly, section.view)) return null;
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
      <DeletionProofFields proof={section.proof} />
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
