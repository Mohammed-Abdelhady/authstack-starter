import { StyleSheet, View } from 'react-native';
import { LIST_VIEW } from '../constants';
import { EMAIL_CODE_LENGTH, EMAIL_STEP, EMAIL_TEST_ID } from '../constants/email-change';
import { useUi } from '../context/ui-context';
import { useEmailChange } from '../hooks/use-email-change';
import { isolateLtr } from '../logic/isolate';
import { SIZE, SPACE } from '../theme/tokens';
import { Button, BUTTON_VARIANT } from './Button';
import { Field } from './Field';
import { Notice, NOTICE_TONE } from './Notice';
import { SkeletonGroup, SkeletonLine } from './Skeleton';
import { Surface } from './Surface';
import { TextField } from './TextField';
import { Description, Heading } from './Typography';

const styles = StyleSheet.create({
  intro: { gap: SPACE.SM },
  group: { gap: SPACE.LG },
});

type EmailChange = ReturnType<typeof useEmailChange>;

function AddressStep({ change }: { change: EmailChange }) {
  const { t } = useUi();
  return (
    <View style={styles.group}>
      <TextField
        testID={EMAIL_TEST_ID.ADDRESS}
        label={t('email.newAddress')}
        hint={t('email.newAddressHint')}
        value={change.address}
        onChangeText={change.setAddress}
        onSubmitEditing={change.send}
        keyboardType="email-address"
        autoComplete="email"
        returnKeyType="send"
        latin
        disabled={change.busy}
      />
      <Button
        testID={EMAIL_TEST_ID.SEND}
        variant={BUTTON_VARIANT.PRIMARY}
        stretch
        label={t('email.send')}
        busy={change.busy}
        onPress={change.send}
      />
      <Button
        testID={EMAIL_TEST_ID.CANCEL}
        variant={BUTTON_VARIANT.LINK}
        label={t('common.cancel')}
        disabled={change.busy}
        onPress={change.stopEditing}
      />
    </View>
  );
}

function CodeStep({ change }: { change: EmailChange }) {
  const { t } = useUi();
  const pending = change.pending ?? '';
  return (
    <View style={styles.group}>
      <Field name={t('email.pending')} value={isolateLtr(pending)} />
      <TextField
        testID={EMAIL_TEST_ID.CODE}
        label={t('email.code')}
        hint={t('email.codeHint', { address: isolateLtr(pending) })}
        value={change.code}
        onChangeText={change.setCode}
        onSubmitEditing={change.confirm}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        returnKeyType="done"
        maxLength={EMAIL_CODE_LENGTH}
        latin
        disabled={change.busy}
      />
      <Button
        testID={EMAIL_TEST_ID.CONFIRM}
        variant={BUTTON_VARIANT.PRIMARY}
        stretch
        label={t('email.confirm')}
        busy={change.busy}
        onPress={change.confirm}
      />
      <Button
        testID={EMAIL_TEST_ID.START}
        variant={BUTTON_VARIANT.OUTLINE}
        label={t('email.otherAddress')}
        disabled={change.busy}
        onPress={change.start}
      />
      <Button
        testID={EMAIL_TEST_ID.CANCEL}
        variant={BUTTON_VARIANT.LINK}
        label={t('email.keepCurrent')}
        disabled={change.busy}
        onPress={change.keepCurrent}
      />
    </View>
  );
}

function EmailBody({ change }: { change: EmailChange }) {
  const { t } = useUi();
  if (change.view === LIST_VIEW.LOADING) {
    return (
      <SkeletonGroup label={t('email.loading')}>
        <SkeletonLine width={SIZE.SKELETON_LONG} height={SIZE.SKELETON_LINE} />
      </SkeletonGroup>
    );
  }
  if (change.view === LIST_VIEW.ERROR) {
    return (
      <View style={styles.group}>
        <Notice tone={NOTICE_TONE.PROBLEM} title={t('email.loadFailed')} />
        <Button testID={EMAIL_TEST_ID.RETRY} label={t('common.tryAgain')} onPress={change.retry} />
      </View>
    );
  }
  return (
    <View style={styles.group}>
      <Field name={t('email.current')} value={isolateLtr(change.current ?? '')} />
      {change.step === EMAIL_STEP.EDITING ? <AddressStep change={change} /> : null}
      {change.step === EMAIL_STEP.AWAITING_CODE ? <CodeStep change={change} /> : null}
      {change.step === EMAIL_STEP.IDLE ? (
        <Button
          testID={EMAIL_TEST_ID.START}
          label={t('email.change')}
          disabled={change.busy}
          onPress={change.start}
        />
      ) : null}
    </View>
  );
}

/**
 * The account's address and the way to change it: ask for a code at the new
 * address, type it here, or keep the current address. The account screen
 * places it.
 */
export function EmailSection() {
  const { t } = useUi();
  const change = useEmailChange();
  return (
    <Surface testID={EMAIL_TEST_ID.SECTION}>
      <View style={styles.intro}>
        <Heading level="section">{t('email.title')}</Heading>
        <Description>{t('email.description')}</Description>
      </View>
      {change.notice === undefined ? null : (
        <Notice
          testID={EMAIL_TEST_ID.NOTICE}
          tone={change.notice.problem ? NOTICE_TONE.PROBLEM : NOTICE_TONE.INFO}
          title={change.notice.title}
          {...(change.notice.description === undefined
            ? {}
            : { description: change.notice.description })}
        />
      )}
      <EmailBody change={change} />
    </Surface>
  );
}
