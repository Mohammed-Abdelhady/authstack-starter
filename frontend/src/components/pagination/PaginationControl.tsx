'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PaginationControlProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  className?: string;
}

export function PaginationControl({
  currentPage,
  totalPages,
  onPageChange,
  isLoading = false,
  className,
}: PaginationControlProps) {
  const t = useTranslations('pagination');

  if (totalPages <= 1) {
    return null;
  }

  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  return (
    <nav
      role="navigation"
      aria-label={t('navigation')}
      className={cn('flex items-center justify-between gap-4 py-4', className)}
      data-testid="pagination-controls"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={isFirstPage}
        busy={isLoading}
        data-testid="pagination-previous"
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        <span>{t('previous')}</span>
      </Button>

      <span className="text-xs text-muted-foreground" aria-live="polite">
        {t('pageInfo', { page: currentPage, totalPages })}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={isLastPage}
        busy={isLoading}
        data-testid="pagination-next"
        className="gap-1"
      >
        <span>{t('next')}</span>
        <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    </nav>
  );
}
