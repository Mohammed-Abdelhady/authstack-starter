import { TextInput } from 'react-native';
import { useCallback, useState, useRef } from 'react';
import { NATIVE_AUTH_FLOW, NATIVE_AUTH_LIMITS } from '@app/core';
import { Button, BUTTON_VARIANT } from '../components/Button';
import { Notice, NOTICE_TONE } from '../components/Notice';
import { TextField } from '../components/TextField';
import { Heading } from '../components/Typography';
import { NATIVE_METHOD, NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import { validNativeEmail, validNativePassword } from '../logic/native-form-validation';
import type { NativeFormActions, NativeUiMethod } from '../types/native-sign-in';
import { useScreenTitleFocus } from '../hooks/use-screen-title-focus';

const METHOD_TEXT = {
  password: 'native.passwordChoice',
  emailLink: 'native.emailLinkChoice',
  emailCode: 'native.emailCodeChoice', // feature:email-code
  registration: 'native.registrationChoice',
  recovery: 'native.recoveryChoice',
} as const;
const SUBMIT_TEXT = {
  password: 'native.signIn',
  emailLink: 'native.sendLink',
  emailCode: 'native.sendSignInCode', // feature:email-code
  registration: 'native.sendCode',
  recovery: 'native.sendCode',
} as const;

export function NativeCredentialScreen({
  method,
  pending,
  submit,
  web,
}: NativeFormActions & { method: NativeUiMethod }) {
  const {
    t,
    locale, // feature:email-code
  } = useUi();
  const title = useScreenTitleFocus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const focusPassword = useCallback(() => passwordRef.current?.focus(), []);
  const passwordMethod = method === NATIVE_METHOD.PASSWORD;
  const send = useCallback(() => {
    if (pending) return;
    const address = email.trim();
    if (!validNativeEmail(address) || (passwordMethod && !validNativePassword(password))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // feature:email-code:start
    if (method === NATIVE_METHOD.EMAIL_CODE) {
      submit({ kind: 'requestEmailCode', email: address, locale });
      return;
    }
    // feature:email-code:end
    if (passwordMethod) {
      submit({ kind: 'password', email: address, password });
      setPassword('');
    } else if (method === NATIVE_METHOD.EMAIL_LINK)
      submit({ kind: 'requestEmailLink', email: address });
    else if (method === NATIVE_METHOD.REGISTRATION) submit({ kind: 'register', email: address });
    else submit({ kind: 'requestRecovery', email: address });
  }, [
    email,
    locale, // feature:email-code
    method,
    password,
    passwordMethod,
    pending,
    submit,
  ]);
  const toggle = useCallback(() => setVisible((value) => !value), []);
  const openWeb = useCallback(
    () =>
      web(
        method === NATIVE_METHOD.REGISTRATION
          ? NATIVE_AUTH_FLOW.REGISTRATION
          : method === NATIVE_METHOD.RECOVERY
            ? NATIVE_AUTH_FLOW.RECOVERY
            : NATIVE_AUTH_FLOW.SIGN_IN,
      ),
    [method, web],
  );
  return (
    <>
      <Heading level="screen" variant="display" nativeRef={title}>
        {t(METHOD_TEXT[method])}
      </Heading>
      <TextField
        label={t('native.email')}
        value={email}
        onChangeText={setEmail}
        latin
        testID={NATIVE_UI_TEST_ID.EMAIL}
        autoComplete="email"
        keyboardType="email-address"
        maxLength={NATIVE_AUTH_LIMITS.EMAIL}
        disabled={pending}
        onSubmitEditing={passwordMethod ? focusPassword : send}
        returnKeyType={passwordMethod ? 'next' : 'done'}
      />
      {passwordMethod ? (
        <>
          <TextField
            label={t('native.password')}
            inputRef={passwordRef}
            value={password}
            onChangeText={setPassword}
            secret={!visible}
            latin
            testID={NATIVE_UI_TEST_ID.PASSWORD}
            autoComplete="current-password"
            disabled={pending}
            returnKeyType="done"
            maxLength={NATIVE_AUTH_LIMITS.PASSWORD_BYTES}
            onSubmitEditing={send}
          />
          <Button
            label={t(visible ? 'native.hidePassword' : 'native.showPassword')}
            variant={BUTTON_VARIANT.LINK}
            onPress={toggle}
            testID={NATIVE_UI_TEST_ID.PASSWORD_VISIBILITY}
            disabled={pending}
          />
        </>
      ) : null}
      {invalid ? <Notice tone={NOTICE_TONE.PROBLEM} title={t('native.invalidInput')} /> : null}
      <Button
        label={t(SUBMIT_TEXT[method])}
        onPress={send}
        busy={pending}
        stretch
        variant={BUTTON_VARIANT.PRIMARY}
        testID={NATIVE_UI_TEST_ID.SUBMIT}
      />
      <Button
        label={t(
          method === NATIVE_METHOD.REGISTRATION
            ? 'native.webRegistration'
            : method === NATIVE_METHOD.RECOVERY
              ? 'native.webRecovery'
              : 'signIn.action',
        )}
        onPress={openWeb}
        disabled={pending}
        stretch
        testID={NATIVE_UI_TEST_ID.WEB}
      />
    </>
  );
}
