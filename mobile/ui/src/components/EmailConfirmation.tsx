import { useCallback, useState } from 'react';
import { useUi } from '../context/ui-context';
import { useEmailConfirmation } from '../hooks/use-email-confirmation';
import { EMAIL_CODE_LENGTH } from '../constants/email-change';
import type { EmailConfirmationProps } from '../types/email-confirmation';
import { Button, BUTTON_VARIANT } from './Button';
import { Notice, NOTICE_TONE } from './Notice';
import { Surface } from './Surface';
import { TextField } from './TextField';
import { Description, Heading } from './Typography';

export function EmailConfirmation(props: EmailConfirmationProps) {
  const { t } = useUi();
  const [open, setOpen] = useState(false);
  const start = useCallback(() => setOpen(true), []);
  const form = useEmailConfirmation(props);
  if (!open)
    return (
      <Button
        testID="staff-email-confirm-open"
        label={t('email.staffConfirm.open')}
        onPress={start}
        variant={BUTTON_VARIANT.LINK}
      />
    );
  return (
    <Surface>
      <Heading level="section">{t('email.staffConfirm.title')}</Heading>
      <Description>{t('email.staffConfirm.description')}</Description>
      {form.confirmed ? (
        <Notice title={t('email.staffConfirm.done')} description={t('email.staffConfirm.signIn')} />
      ) : (
        <>
          {form.notice ? (
            <Notice
              title={form.notice.title}
              description={form.notice.description}
              tone={NOTICE_TONE.PROBLEM}
            />
          ) : null}
          <TextField
            testID="staff-email-confirm-address"
            label={t('email.newAddress')}
            value={form.email}
            onChangeText={form.setEmail}
            keyboardType="email-address"
            autoComplete="email"
            latin
            disabled={form.busy}
          />
          <TextField
            testID="staff-email-confirm-code"
            label={t('email.code')}
            value={form.code}
            onChangeText={form.setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            latin
            maxLength={EMAIL_CODE_LENGTH}
            disabled={form.busy}
          />
          <Button
            testID="staff-email-confirm-submit"
            label={t('email.confirm')}
            onPress={form.submit}
            disabled={!form.valid}
            busy={form.busy}
          />
        </>
      )}
    </Surface>
  );
}
