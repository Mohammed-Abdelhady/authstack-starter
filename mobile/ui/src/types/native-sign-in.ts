import type { NativeProviderMethod } from '@app/sdk';

export interface NativeProviderButtonProps {
  method: NativeProviderMethod;
  disabled: boolean;
  pending: boolean;
  label: string;
  onPress: () => void;
  locale: 'en' | 'ar';
  testID?: string;
}
