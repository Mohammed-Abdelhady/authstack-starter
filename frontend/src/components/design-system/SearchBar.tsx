'use client';

import { forwardRef, InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { cn } from '@/lib/utils';
import { TEXT_CONTROL_FONT_SIZE } from '@/lib/config/form-styles';

export interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Callback when clear button is clicked
   */
  onClear?: () => void;

  /**
   * Show clear button when input has value
   */
  showClear?: boolean;
}

/**
 * SearchBar - Underline-style search input
 *
 * Features:
 * - No border, only bottom underline
 * - Search icon on the leading edge
 * - Optional clear button on the trailing edge, 24px hit area
 * - Focus ring on the input, accent underline while focused
 *
 * @example
 * ```tsx
 * <SearchBar
 *   placeholder="Search users..."
 *   value={searchQuery}
 *   onChange={(e) => setSearchQuery(e.target.value)}
 *   onClear={() => setSearchQuery('')}
 *   showClear={searchQuery.length > 0}
 * />
 * ```
 */
export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  ({ className, onClear, showClear = false, value, ...props }, ref) => {
    const t = useTranslations('common');

    return (
      <div className={cn('relative group', className)}>
        {/* Search Icon */}
        <Search
          aria-hidden="true"
          className="absolute start-0 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary"
        />

        {/* Input */}
        <input
          ref={ref}
          type="text"
          value={value}
          className={cn(
            'w-full bg-transparent ps-7 pe-8 py-2',
            'text-foreground placeholder:text-muted-foreground',
            // A placeholder longer than the box ends in an ellipsis.
            'text-ellipsis placeholder:text-ellipsis',
            TEXT_CONTROL_FONT_SIZE,
            'border-0 border-b border-border rounded-sm',
            'focus:border-primary',
            'transition-all duration-200 ease-out',
            FOCUS_RING_CLASSES,
          )}
          data-testid="search-bar"
          {...props}
        />

        {/* Clear Button */}
        {showClear && onClear && (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              'absolute end-0 top-1/2 -translate-y-1/2',
              'h-6 w-6 rounded-full',
              'flex items-center justify-center',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-muted',
              'transition-colors duration-150',
              FOCUS_RING_CLASSES,
            )}
            data-testid="clear-search-button"
            aria-label={t('clearSearch')}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  },
);

SearchBar.displayName = 'SearchBar';
