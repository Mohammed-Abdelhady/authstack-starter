'use client';

import { useTranslations } from 'next-intl';
import { RoleFilter } from './RoleFilter';
import { SearchBar } from '@/components/design-system';
import { FREE_TEXT_SEARCH_CLASSES } from '@/modules/permissions/constants/freeText';

export interface UserListToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  roleFilter: string;
  onRoleFilterChange: (role: string) => void;
}

export function UserListToolbar({
  searchQuery,
  onSearchChange,
  onSearchClear,
  roleFilter,
  onRoleFilterChange,
}: UserListToolbarProps) {
  const t = useTranslations('users');

  return (
    <div className="mb-8 flex flex-col sm:flex-row gap-4">
      <div className="flex-1">
        <SearchBar
          className={FREE_TEXT_SEARCH_CLASSES}
          placeholder={t('searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onClear={onSearchClear}
          showClear={searchQuery.length > 0}
          data-testid="search-users-input"
        />
      </div>
      <RoleFilter value={roleFilter} onChange={onRoleFilterChange} />
    </div>
  );
}
