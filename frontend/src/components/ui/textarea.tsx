import * as React from 'react';

import { cn } from '@/lib/utils';
import { TEXT_CONTROL_FONT_SIZE } from '@/lib/config/form-styles';
import { busyFieldProps } from './busy';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** The request of its form is running: it keeps focus and cannot be edited. */
  busy?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, busy, readOnly, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
          TEXT_CONTROL_FONT_SIZE,
          className,
        )}
        ref={ref}
        {...props}
        {...busyFieldProps(busy, readOnly)}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
