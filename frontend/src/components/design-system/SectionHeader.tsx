import { forwardRef, HTMLAttributes, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { HEADING_ROLE_CLASSES } from '@/constants/typography';
import { cn } from '@/lib/utils';

const TITLE_CLASSES = cn('flex items-center gap-2', HEADING_ROLE_CLASSES.eyebrow);

export interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Section title
   */
  title: string;

  /**
   * Optional count to display next to title
   */
  count?: number;

  /**
   * Action buttons or elements to display on the right
   */
  actions?: ReactNode;

  /**
   * Make section collapsible
   */
  collapsible?: boolean;

  /**
   * Collapsed state (controlled)
   */
  collapsed?: boolean;

  /**
   * Callback when collapse state changes
   */
  onCollapse?: (collapsed: boolean) => void;

  /**
   * Id of the region the toggle shows and hides. Required for `aria-controls`
   * when the section is collapsible.
   */
  contentId?: string;
}

/**
 * SectionHeader - Consistent section headers across pages
 *
 * Features:
 * - Uppercase tracking for minimal aesthetic
 * - Optional count badge
 * - Optional action buttons
 * - Optional collapse functionality
 * - Subtle divider line
 *
 * @example
 * ```tsx
 * <SectionHeader
 *   title="Verified Users"
 *   count={18}
 *   actions={<Button size="sm">Add</Button>}
 *   collapsible
 *   collapsed={isCollapsed}
 *   onCollapse={setIsCollapsed}
 * />
 * ```
 */
export const SectionHeader = forwardRef<HTMLDivElement, SectionHeaderProps>(
  (
    {
      title,
      count,
      actions,
      collapsible = false,
      collapsed = false,
      onCollapse,
      contentId,
      className,
      ...props
    },
    ref,
  ) => {
    const handleToggle = () => {
      if (collapsible && onCollapse) {
        onCollapse(!collapsed);
      }
    };

    const titleContent = (
      <span>
        {title}
        {typeof count === 'number' && <span className="ms-2 text-tertiary">({count})</span>}
      </span>
    );

    return (
      <div
        ref={ref}
        data-testid="section-header"
        className={cn('pb-3 border-b border-border mb-4', className)}
        {...props}
      >
        <div className="flex items-center justify-between">
          {/* A static section is a plain heading; a collapsible one wraps a toggle */}
          <h2 className={cn(!collapsible && TITLE_CLASSES)} data-testid="section-header-heading">
            {collapsible ? (
              <button
                type="button"
                onClick={handleToggle}
                aria-expanded={!collapsed}
                aria-controls={contentId}
                className={cn(
                  TITLE_CLASSES,
                  'rounded-sm hover:text-foreground transition-colors cursor-pointer',
                  FOCUS_RING_CLASSES,
                )}
                data-testid="section-header-title"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'h-3 w-3 motion-safe:transition-transform motion-safe:duration-200',
                    collapsed && 'ltr:-rotate-90 rtl:rotate-90',
                  )}
                  data-testid="collapse-icon"
                />
                {titleContent}
              </button>
            ) : (
              titleContent
            )}
          </h2>

          {/* Actions */}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    );
  },
);

SectionHeader.displayName = 'SectionHeader';
