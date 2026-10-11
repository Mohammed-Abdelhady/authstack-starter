'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { SearchBar } from '@/components/design-system';
import { PaginationControl } from '@/components/pagination';
import { useListRolesQuery } from '@/modules/roles/api/rolesApi';
import { useAllRoles } from '@/modules/roles/hooks/useAllRoles';
import { useDebounce } from '@/hooks/useDebounce';
import { FREE_TEXT_SEARCH_CLASSES } from '@/modules/permissions/constants/freeText';
import { TruncatedText } from '@/modules/permissions/components/shared/TruncatedText';
import type { Role } from '@/modules/roles/types';

export function RoleFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (role: string) => void;
}) {
  const t = useTranslations('users');
  const rolesText = useTranslations('roles');
  const common = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // The filter value is a slug. Its name comes from the role picked here, or
  // from the list of every role once the page has read it.
  const [picked, setPicked] = useState<Pick<Role, 'slug' | 'name'> | null>(null);
  const { roles: allRoles } = useAllRoles();
  const query = useDebounce(search, 300);
  const { currentData, isFetching, isError, refetch } = useListRolesQuery(
    { page, limit: 20, search: query.trim() || undefined },
    { skip: !open },
  );
  const lastPage = Math.max(1, currentData?.totalPages ?? page);
  if (!isFetching && !isError && page > lastPage) setPage(lastPage);

  function choose(role: Pick<Role, 'slug' | 'name'> | null) {
    setPicked(role);
    onChange(role?.slug ?? 'all');
    setOpen(false);
  }

  const known = picked?.slug === value ? picked : allRoles.find((role) => role.slug === value);
  const pickedName = known?.name ?? null;

  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full sm:w-50 justify-between"
          data-testid="role-filter"
        >
          {value === 'all' ? (
            <span className="truncate">{t('allRoles')}</span>
          ) : (
            <span className="flex min-w-0 flex-1">
              <TruncatedText
                value={pickedName ?? value}
                dir={pickedName === null ? 'ltr' : 'auto'}
                testId="role-filter-value"
              />
            </span>
          )}
          <ChevronDown className="ms-2 h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="role-filter-dialog" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('roleFilterTitle')}</DialogTitle>
          <DialogDescription>{t('roleFilterHint')}</DialogDescription>
        </DialogHeader>
        <SearchBar
          className={FREE_TEXT_SEARCH_CLASSES}
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          onClear={() => changeSearch('')}
          showClear={search.length > 0}
          placeholder={rolesText('searchPlaceholder')}
          aria-label={rolesText('searchPlaceholder')}
          data-testid="role-filter-search"
        />
        <Button
          variant={value === 'all' ? 'secondary' : 'ghost'}
          onClick={() => choose(null)}
          aria-pressed={value === 'all'}
          data-testid="role-filter-all"
        >
          {t('allRoles')}
        </Button>
        <div aria-busy={isFetching}>
          {isFetching && <p role="status">{rolesText('loading')}</p>}
          {isError ? (
            <div role="alert" className="space-y-2">
              <p>{t('roleFilterError')}</p>
              <Button
                onClick={() => refetch()}
                busy={isFetching}
                aria-busy={isFetching}
                data-testid="role-filter-retry"
              >
                {common('retry')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1" data-testid="role-filter-results">
              {currentData?.roles.map((role) => (
                <Button
                  key={role.id}
                  variant={value === role.slug ? 'secondary' : 'ghost'}
                  className="h-auto min-h-10 justify-start whitespace-normal text-start [overflow-wrap:anywhere]"
                  busy={isFetching}
                  aria-pressed={value === role.slug}
                  onClick={() => choose(role)}
                  data-testid={`role-filter-option-${role.slug}`}
                >
                  <span className="min-w-0">
                    <span dir="auto">{role.name}</span>
                  </span>
                </Button>
              ))}
              {!isFetching && currentData?.roles.length === 0 && (
                <p role="status">{rolesText('noRoles')}</p>
              )}
            </div>
          )}
        </div>
        <PaginationControl
          currentPage={page}
          totalPages={lastPage}
          onPageChange={setPage}
          isLoading={isFetching}
        />
      </DialogContent>
    </Dialog>
  );
}
