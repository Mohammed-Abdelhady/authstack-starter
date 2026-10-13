import { NATIVE_AUTH_STAGE } from '@app/core';
import { TextInput } from 'react-native';
import { useCallback, useState, useRef } from 'react';
import {
  NATIVE_AUTH_FLOW,
  NATIVE_AUTH_LIMITS,
  NATIVE_AUTH_PATTERN,
  MIN_PASSWORD_LENGTH,
} from '@app/core';
import type { NativeSafeAttemptView } from '@app/native-auth';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { TextField } from '../components/TextField';
import { Description, Heading } from '../components/Typography';
import { NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import { validNativeName, validNativePassword } from '../logic/native-form-validation';
import type { NativeFormActions } from '../types/native-sign-in';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

type CodeView = Extract<
  NativeSafeAttemptView,
  { stage: 'registrationCodeRequired' | 'recoveryCodeRequired' }
>;
// TextInput counts UTF-16 units; a permitted code point can use two.
const NAME_INPUT_CODE_UNITS = NATIVE_AUTH_LIMITS.NAME * 2;
export function NativeCodeScreen({
  view,
  pending,
  submit,
  web,
  resend,
}: NativeFormActions & { view: CodeView; resend(): void }) {
  const { t } = useUi();
  const title = useScreenTitleFocus();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const focusPassword = useCallback(() => passwordRef.current?.focus(), []);
  const registration = view.stage === NATIVE_AUTH_STAGE.REGISTRATION_CODE_REQUIRED;
  const nextField = useCallback(
    () => (registration ? nameRef.current?.focus() : passwordRef.current?.focus()),
    [registration],
  );
  const send = useCallback(() => {
    if (pending) return;
    if (
      !NATIVE_AUTH_PATTERN.ACTIVATION_CODE.test(code.trim()) ||
      !validNativePassword(password, true) ||
      (registration && !validNativeName(name))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (registration)
      submit({
        kind: 'activate',
        input: {
          email: view.email,
          code: code.trim(),
          name: name.trim().normalize('NFC'),
          password,
        },
      });
    else
      submit({
        kind: 'confirmRecovery',
        input: { email: view.email, code: code.trim(), newPassword: password },
      });
    setCode('');
    setPassword('');
  }, [code, name, password, pending, registration, submit, view.email]);
  const toggle = useCallback(() => setVisible((value) => !value), []);
  const openWeb = useCallback(
    () => web(registration ? NATIVE_AUTH_FLOW.REGISTRATION : NATIVE_AUTH_FLOW.RECOVERY),
    [registration, web],
  );
  return (
    <>
      <Heading level="screen" nativeRef={title}>
        {t(registration ? 'native.registrationCode' : 'native.recoveryCodeTitle')}
      </Heading>
      <Description>
        {t(registration ? 'native.registrationCodeHint' : 'native.recoveryCodeHint', {
          email: view.email,
        })}
      </Description>
      <TextField
        label={t('native.code')}
        returnKeyType="next"
        onSubmitEditing={nextField}
        value={code}
        onChangeText={setCode}
        latin
        disabled={pending}
        autoComplete="one-time-code"
        keyboardType="number-pad"
        maxLength={NATIVE_AUTH_LIMITS.ACTIVATION_CODE_LENGTH}
        testID={NATIVE_UI_TEST_ID.CODE}
      />
      {registration ? (
        <TextField
          label={t('native.name')}
          inputRef={nameRef}
          onSubmitEditing={focusPassword}
          returnKeyType="next"
          autoCapitalize="words"
          value={name}
          onChangeText={setName}
          disabled={pending}
          autoComplete="name"
          maxLength={NAME_INPUT_CODE_UNITS}
          testID={NATIVE_UI_TEST_ID.NAME}
        />
      ) : null}
      <TextField
        label={t('native.newPassword')}
        inputRef={passwordRef}
        value={password}
        onChangeText={setPassword}
        disabled={pending}
        autoComplete="new-password"
        secret={!visible}
        latin
        maxLength={NATIVE_AUTH_LIMITS.PASSWORD_BYTES}
        hint={t('native.passwordHint', {
          min: String(MIN_PASSWORD_LENGTH),
          max: String(NATIVE_AUTH_LIMITS.PASSWORD_BYTES),
        })}
        returnKeyType="done"
        onSubmitEditing={send}
        testID={NATIVE_UI_TEST_ID.PASSWORD}
      />
      <Button
        label={t(visible ? 'native.hidePassword' : 'native.showPassword')}
        disabled={pending}
        onPress={toggle}
        testID={NATIVE_UI_TEST_ID.PASSWORD_VISIBILITY}
      />
      {invalid ? <Notice title={t('native.invalidInput')} tone={NOTICE_TONE.PROBLEM} /> : null}
      <Button
        label={t(registration ? 'native.activate' : 'native.reset')}
        onPress={send}
        busy={pending}
        variant={BUTTON_VARIANT.PRIMARY}
        stretch
        testID={NATIVE_UI_TEST_ID.SUBMIT}
      />
      <Button
        label={t('native.resend')}
        onPress={resend}
        disabled={pending}
        stretch
        testID={NATIVE_UI_TEST_ID.RESEND}
      />
      <Button
        label={t(registration ? 'native.webRegistration' : 'native.webRecovery')}
        onPress={openWeb}
        disabled={pending}
        stretch
        testID={NATIVE_UI_TEST_ID.WEB}
      />
    </>
  );
}
