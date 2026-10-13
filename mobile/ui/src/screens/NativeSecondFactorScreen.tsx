import { useCallback, useState } from 'react';
import type { NativeSafeAttemptView } from '@app/native-auth';
import { NATIVE_AUTH_PATTERN, NATIVE_AUTH_LIMITS } from '@app/core';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { TextField } from '../components/TextField';
import { Description, Heading } from '../components/Typography';
import { NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import type { NativeFormActions } from '../types/native-sign-in';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

type SecondFactorView = Extract<NativeSafeAttemptView, { stage: 'secondFactorRequired' }>;
export function NativeSecondFactorScreen({
  view,
  pending,
  submit,
  passkeyAvailable,
}: NativeFormActions & { view: SecondFactorView; passkeyAvailable: boolean }) {
  const { t } = useUi();
  const title = useScreenTitleFocus();
  const [factor, setFactor] = useState<'totp' | 'recoveryCode'>();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const chooseTotp = useCallback(() => {
    setFactor('totp');
    setCode('');
    setInvalid(false);
  }, []);
  const chooseRecovery = useCallback(() => {
    setFactor('recoveryCode');
    setCode('');
    setInvalid(false);
  }, []);
  const passkey = useCallback(() => {
    setCode('');
    setFactor(undefined);
    setInvalid(false);
    submit({ kind: 'passkey' });
  }, [submit]);
  const send = useCallback(() => {
    if (pending || !factor) return;
    const value = code.trim();
    const pattern =
      factor === 'totp'
        ? NATIVE_AUTH_PATTERN.SECOND_FACTOR_CODE
        : NATIVE_AUTH_PATTERN.RECOVERY_CODE;
    if (!pattern.test(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    submit({
      kind: 'secondFactor',
      input: factor === 'totp' ? { code: value } : { recoveryCode: value },
    });
    setCode('');
  }, [code, factor, pending, submit]);
  return (
    <>
      <Heading level="screen" variant="display" nativeRef={title}>
        {t('native.secondFactor')}
      </Heading>
      <Description>{t('native.secondFactorHint')}</Description>
      {view.factors.includes('totp') ? (
        <Button
          label={t('native.totpChoice')}
          onPress={chooseTotp}
          disabled={pending}
          testID={NATIVE_UI_TEST_ID.TOTP}
          stretch
        />
      ) : null}
      {view.factors.includes('recoveryCode') ? (
        <Button
          label={t('native.recoveryCodeChoice')}
          onPress={chooseRecovery}
          disabled={pending}
          testID={NATIVE_UI_TEST_ID.RECOVERY_CODE}
          stretch
        />
      ) : null}
      {passkeyAvailable && view.factors.includes('passkey') ? (
        <Button
          label={t('native.passkeyVerify')}
          onPress={passkey}
          busy={pending}
          testID={NATIVE_UI_TEST_ID.PASSKEY_CHOICE}
          stretch
        />
      ) : null}
      {factor ? (
        <>
          <TextField
            label={t(factor === 'totp' ? 'native.totpCode' : 'native.recoveryCode')}
            value={code}
            onChangeText={setCode}
            testID={NATIVE_UI_TEST_ID.CODE}
            latin
            disabled={pending}
            autoComplete={factor === 'totp' ? 'one-time-code' : 'off'}
            keyboardType={factor === 'totp' ? 'number-pad' : 'default'}
            maxLength={
              factor === 'totp'
                ? NATIVE_AUTH_LIMITS.SECOND_FACTOR_CODE_LENGTH
                : NATIVE_AUTH_LIMITS.RECOVERY_CODE
            }
            returnKeyType="done"
            onSubmitEditing={send}
          />
          {invalid ? <Notice title={t('native.invalidInput')} tone={NOTICE_TONE.PROBLEM} /> : null}
          <Button
            label={t('native.verify')}
            onPress={send}
            busy={pending}
            stretch
            variant={BUTTON_VARIANT.PRIMARY}
            testID={NATIVE_UI_TEST_ID.SUBMIT}
          />
        </>
      ) : null}
    </>
  );
}
