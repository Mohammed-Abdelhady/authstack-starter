import { forwardRef, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TimelineListProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Array of items to render
   */
  items: T[];

  /**
   * What identifies an item. An item keeps its own state, an open dialog
   * included, when the list is re-ordered or loses a neighbour.
   */
  itemKey: (item: T) => string | number;

  /**
   * Render function for each item
   */
  renderItem: (item: T, index: number) => ReactNode;

  /**
   * Highlight a specific item (e.g., current session)
   */
  highlightIndex?: number;

  /**
   * Enable stagger animation for items
   */
  stagger?: boolean;
}

/**
 * TimelineList - Vertical timeline layout
 *
 * Features:
 * - Vertical list with timeline aesthetic
 * - Optional highlighted item
 * - Stagger animations on mount
 * - Chronological order visualization
 * - Responsive spacing
 *
 * @example
 * ```tsx
 * <TimelineList
 *   items={sessions}
 *   renderItem={(session, index) => (
 *     <SessionCardTimeline session={session} isCurrent={session.isCurrent} />
 *   )}
 *   itemKey={(session) => session.id}
 *   highlightIndex={sessions.findIndex(s => s.isCurrent)}
 *   stagger
 * />
 * ```
 */
export const TimelineList = forwardRef(
  <T,>(
    {
      items,
      itemKey,
      renderItem,
      highlightIndex,
      stagger = false,
      className,
      ...props
    }: TimelineListProps<T>,
    ref: React.ForwardedRef<HTMLDivElement>,
  ) => {
    return (
      <div
        ref={ref}
        role="list"
        data-testid="timeline-list"
        className={cn('flex flex-col space-y-4', className)}
        {...props}
      >
        {items.map((item, index) => {
          const isHighlighted = highlightIndex !== undefined && index === highlightIndex;

          return (
            <div
              role="listitem"
              key={itemKey(item)}
              data-testid={`timeline-item-${index}`}
              data-highlighted={isHighlighted ? 'true' : undefined}
              className={cn(
                'transition-all duration-300 ease-out',
                stagger && 'motion-safe:animate-slide-up motion-safe:stagger-animation',
              )}
              style={stagger ? ({ '--index': index } as React.CSSProperties) : undefined}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    );
  },
) as (<T>(
  props: TimelineListProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> },
) => React.ReactElement) & { displayName?: string };

TimelineList.displayName = 'TimelineList';
