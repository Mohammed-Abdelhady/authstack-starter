import type { ComponentPropsWithoutRef } from 'react';
import type { Content } from '@radix-ui/react-dialog';
import type { SafeMarkupProps } from './markup';

export interface DialogContentProps extends SafeMarkupProps<
  ComponentPropsWithoutRef<typeof Content>
> {
  showCloseButton?: boolean;
}
