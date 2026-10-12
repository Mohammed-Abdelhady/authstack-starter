import { cn } from '@/lib/utils';

export interface TruncatedTextProps {
  /** The whole value. It stays in the page even when the line is cut. */
  value: string;
  /** `ltr` for an address or a key, `auto` for text a person typed in any language. */
  dir: 'ltr' | 'auto';
  className?: string;
  testId?: string;
}

/**
 * One line that is cut with an ellipsis at the end of the value, whatever the
 * direction of the page. Put it in a `flex min-w-0` parent: the parent keeps
 * it at the start edge of the row, and its own `dir` decides which end is cut.
 *
 * Only for a value whose whole text is on screen somewhere a keyboard reaches,
 * such as the label of a button that opens the full list. Anywhere else, let
 * the value wrap.
 *
 * @example
 * ```tsx
 * <span className="flex min-w-0">
 *   <TruncatedText value={role.name} dir="auto" />
 * </span>
 * ```
 */
export function TruncatedText({
  value,
  dir,
  className,
  testId,
}: TruncatedTextProps): React.JSX.Element {
  return (
    <span dir={dir} className={cn('min-w-0 truncate', className)} data-testid={testId}>
      {value}
    </span>
  );
}
