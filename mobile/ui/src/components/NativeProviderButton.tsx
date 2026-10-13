import { useCallback, memo, type ComponentType } from 'react';
import { NATIVE_PROVIDER_SDK_MODE } from '@app/core';
import { Button } from './Button';
import type { NativeProviderButtonProps } from '../types/native-sign-in';
import { useUi } from '../context/ui-context';

interface ProviderChoiceProps {
  method: NativeProviderButtonProps['method'];
  disabled: boolean;
  pending: boolean;
  renderer?: ComponentType<NativeProviderButtonProps>;
  select(providerId: string): void;
  web(providerId: string): void;
}
export const NativeProviderButton = memo(function NativeProviderButton({
  method,
  disabled,
  pending,
  renderer: Renderer,
  select,
  web,
}: ProviderChoiceProps) {
  const { t, locale } = useUi();
  const hostRequired =
    method.mode === NATIVE_PROVIDER_SDK_MODE.GOOGLE_IDENTITY_TOKEN ||
    method.mode === NATIVE_PROVIDER_SDK_MODE.APPLE_IDENTITY_TOKEN_AND_CODE;
  const unavailableRenderer = hostRequired && !Renderer;
  const label = t(unavailableRenderer ? 'native.providerWeb' : 'native.providerChoice', {
    provider: method.displayName,
  });
  const act = useCallback(
    () => (unavailableRenderer ? web(method.id) : select(method.id)),
    [method.id, select, unavailableRenderer, web],
  );
  const testID = `native-provider-${method.id}`;
  return hostRequired && Renderer ? (
    <Renderer
      method={method}
      disabled={disabled}
      pending={pending}
      label={label}
      onPress={act}
      locale={locale}
      testID={testID}
    />
  ) : (
    <Button
      label={label}
      onPress={act}
      disabled={disabled}
      busy={pending}
      stretch
      testID={testID}
    />
  );
});
