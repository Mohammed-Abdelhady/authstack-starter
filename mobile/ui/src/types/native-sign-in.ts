import type { NativeProviderMethod, NativeFlow } from '@app/sdk';
import type { NativeSignInAction } from '@app/native-auth';
import type { NATIVE_METHOD } from '../constants/native-sign-in';

export interface NativeProviderButtonProps {
  method: NativeProviderMethod;
  disabled: boolean;
  pending: boolean;
  label: string;
  onPress: () => void;
  locale: 'en' | 'ar';
  testID?: string;
}

export type NativeUiMethod = (typeof NATIVE_METHOD)[keyof typeof NATIVE_METHOD];

export interface NativeFormActions {
  pending: boolean;
  submit(action: NativeSignInAction): void;
  web(flow?: NativeFlow): void;
  cancel(): void;
}
