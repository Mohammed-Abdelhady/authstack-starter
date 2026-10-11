'use client';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';

export interface TruncatedTextProps {
  /** The whole value. It stays in the page even when the line is cut. */
  value: string;
  /** `ltr` for an address or a key, `auto` for text a person typed in any language. */
  dir: 'ltr' | 'auto';
  /** Shows the whole value in a tooltip on hover and on keyboard focus. */
  reveal?: boolean;
  className?: string;
  testId?: string;
}

/**
 * One line that is cut with an ellipsis at the end of the value, whatever the
 * direction of the page. Put it in a `flex min-w-0` parent: the parent keeps
 * it at the start edge of the row, and its own `dir` decides which end is cut.
 *
 * @example
 * ```tsx
 * <p className="flex min-w-0">
 *   <TruncatedText value={user.email} dir="ltr" reveal />
 * </p>
 * ```
 */
export function TruncatedText({
  value,
  dir,
  reveal = false,
  className,
  testId,
}: TruncatedTextProps): React.JSX.Element {
  if (!reveal) {
    return (
      <span dir={dir} className={cn('min-w-0 truncate', className)} data-testid={testId}>
        {value}
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            dir={dir}
            tabIndex={0}
            className={cn('min-w-0 truncate rounded-sm', FOCUS_RING_CLASSES, className)}
            data-testid={testId}
          >
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent
          dir={dir}
          className="max-w-[var(--radix-tooltip-content-available-width)] break-all"
        >
          {value}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
