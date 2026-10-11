'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RoleListError } from '@/modules/roles/components/RoleListError';
import { RoleRefusalBadge } from '@/modules/roles/components/RoleRefusalBadge';
import type { AllRoles } from '@/modules/roles/hooks/useAllRoles';
import { TruncatedText } from '../shared/TruncatedText';

export interface CreateUserRoleFieldProps {
  id: string;
  /** The slug the form will send. */
  value: string;
  onChange: (slug: string) => void;
  /** Every role, read by the dialog so it knows whether the field can be shown. */
  allRoles: AllRoles;
  /** The create request is running. */
  busy: boolean;
  /** The id of the message that says what is wrong with the field, when one shows. */
  errorId?: string;
}

/**
 * The role of a new user. It lists every role and holds back the ones the
 * server would refuse from this person, each with its reason. The value the
 * form will send is always the one shown.
 */
export function CreateUserRoleField({
  id,
  value,
  onChange,
  allRoles,
  busy,
  errorId,
}: CreateUserRoleFieldProps) {
  const t = useTranslations('users.createUser');
  const { roles, isLoading: isLoadingRoles, isError, retry, refusalFor } = allRoles;
  const selected = roles.find((role) => role.slug === value);

  if (isError) {
    return <RoleListError announce onRetry={retry} testId="create-user-roles-error" />;
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={isLoadingRoles} busy={busy}>
      <SelectTrigger
        id={id}
        aria-invalid={errorId !== undefined}
        aria-describedby={errorId}
        className={errorId ? 'border-destructive' : ''}
        data-testid="create-user-role-select"
      >
        {isLoadingRoles ? (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <SelectValue placeholder={t('selectRole')}>
            {/* One line, cut at the end of the name. The list shows it whole. */}
            {selected ? (
              <span className="flex min-w-0">
                <TruncatedText value={selected.name} dir="auto" />
              </span>
            ) : undefined}
          </SelectValue>
        )}
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => {
          const refusal = refusalFor(role);
          return (
            <SelectItem
              key={role.id}
              value={role.slug}
              unavailableReason={refusal ? <RoleRefusalBadge refusal={refusal} /> : undefined}
              data-testid={`role-option-${role.slug}`}
            >
              <div className="flex items-center gap-2">
                <span dir="auto">{role.name}</span>
                {role.isSystemRole && (
                  <span className="text-xs text-tertiary">{t('systemRole')}</span>
                )}
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
