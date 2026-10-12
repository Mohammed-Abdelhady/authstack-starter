import { withoutUnsafeMarkup } from '@/lib/unsafeMarkup';
import type { SafeMarkupProps } from '@/types/markup';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { TEXT_CONTROL_FONT_SIZE } from '@/lib/config/form-styles';
import { BUSY_FIELD_CLASSES, busyFieldProps } from './busy';

export interface TextareaProps extends SafeMarkupProps<React.ComponentProps<'textarea'>> {
  /** The request of its form is running: it keeps focus and cannot be edited. */
  busy?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, busy, readOnly, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          BUSY_FIELD_CLASSES,
          TEXT_CONTROL_FONT_SIZE,
          className,
        )}
        ref={ref}
        {...withoutUnsafeMarkup(props)}
        {...busyFieldProps(busy, readOnly)}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
