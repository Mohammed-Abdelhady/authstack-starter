import { useCallback } from 'react';
import { NATIVE_PROVIDER_SDK_MODE } from '@app/core';
import type { ComponentType } from 'react';
import type { NativeMethods } from '@app/sdk';
import { Button, BUTTON_VARIANT } from './Button';
import { NativeProviderButton } from './NativeProviderButton';
import { NATIVE_METHOD, NATIVE_UI_TEST_ID } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import type { NativeProviderButtonProps, NativeUiMethod } from '../types/native-sign-in';

interface ChoicesProps {
  methods: NativeMethods;
  disabled: boolean;
  pendingFactor?: string;
  providerButton?: ComponentType<NativeProviderButtonProps>;
  choose(method: NativeUiMethod): void;
  startFactor(action: 'passkey' | { providerId: string }): void;
  providerWeb(providerId: string): void;
}

/** Whether the mailed link is a choice of its own. */
function offersEmailLink(capabilities: NativeMethods['capabilities']): boolean {
  // feature:email-code:start
  // The code mail carries the link as its button, so one email choice covers both.
  if (capabilities.emailCode === true) return false;
  // feature:email-code:end
  return capabilities.emailLink;
}

export function NativeMethodChoices({
  methods,
  disabled,
  pendingFactor,
  providerButton,
  choose,
  startFactor,
  providerWeb,
}: ChoicesProps) {
  const { t } = useUi();
  const password = useCallback(() => choose(NATIVE_METHOD.PASSWORD), [choose]);
  const emailLink = useCallback(() => choose(NATIVE_METHOD.EMAIL_LINK), [choose]);
  // feature:email-code:start
  const emailCode = useCallback(() => choose(NATIVE_METHOD.EMAIL_CODE), [choose]);
  // feature:email-code:end
  const registration = useCallback(() => choose(NATIVE_METHOD.REGISTRATION), [choose]);
  const recovery = useCallback(() => choose(NATIVE_METHOD.RECOVERY), [choose]);
  const passkey = useCallback(() => startFactor('passkey'), [startFactor]);
  const provider = useCallback(
    (providerId: string) => {
      const method = methods.providers.find((candidate) => candidate.id === providerId);
      if (method?.mode === NATIVE_PROVIDER_SDK_MODE.SYSTEM) providerWeb(providerId);
      else startFactor({ providerId });
    },
    [methods.providers, providerWeb, startFactor],
  );
  if (!methods.nativeEnabled) return null;
  return (
    <>
      {methods.capabilities.password ? (
        <Button
          label={t('native.passwordChoice')}
          variant={BUTTON_VARIANT.PRIMARY}
          onPress={password}
          disabled={disabled}
          stretch
          testID={NATIVE_UI_TEST_ID.PASSWORD_CHOICE}
        />
      ) : null}
      {methods.capabilities.passkeys ? (
        <Button
          label={t('native.passkeyChoice')}
          variant={BUTTON_VARIANT.OUTLINE}
          busy={pendingFactor === 'passkey'}
          onPress={passkey}
          disabled={disabled}
          stretch
          testID={NATIVE_UI_TEST_ID.PASSKEY_CHOICE}
        />
      ) : null}
      {methods.providers.map((method) => (
        <NativeProviderButton
          key={method.id}
          method={method}
          disabled={disabled}
          pending={pendingFactor === method.id}
          renderer={providerButton}
          select={provider}
          web={providerWeb}
        />
      ))}
      {/* feature:email-code:start */}
      {methods.capabilities.emailCode === true ? (
        <Button
          label={t('native.emailCodeChoice')}
          onPress={emailCode}
          disabled={disabled}
          stretch
          testID={NATIVE_UI_TEST_ID.EMAIL_CODE_CHOICE}
        />
      ) : null}
      {/* feature:email-code:end */}
      {offersEmailLink(methods.capabilities) ? (
        <Button
          label={t('native.emailLinkChoice')}
          onPress={emailLink}
          disabled={disabled}
          stretch
          testID={NATIVE_UI_TEST_ID.EMAIL_LINK_CHOICE}
        />
      ) : null}
      {methods.capabilities.registration ? (
        <Button
          label={t('native.registrationChoice')}
          onPress={registration}
          disabled={disabled}
          stretch
          testID={NATIVE_UI_TEST_ID.REGISTRATION_CHOICE}
        />
      ) : null}
      {methods.capabilities.recovery ? (
        <Button
          label={t('native.recoveryChoice')}
          variant={BUTTON_VARIANT.LINK}
          onPress={recovery}
          disabled={disabled}
          stretch
          testID={NATIVE_UI_TEST_ID.RECOVERY_CHOICE}
        />
      ) : null}
    </>
  );
}
