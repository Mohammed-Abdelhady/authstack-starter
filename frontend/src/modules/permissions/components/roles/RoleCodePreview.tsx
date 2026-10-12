'use client';

import { useTranslations } from 'next-intl';
import { ROLE_NAME_PATTERN, roleSlug } from '@app/core';

/**
 * The code the server will make from a role name as it is typed, or nothing
 * while the name holds a character the server refuses.
 */
export function previewedRoleCode(name: string): string {
  return ROLE_NAME_PATTERN.test(name) ? roleSlug(name) : '';
}

/** The ids a field is described by, without the ones that are not on the page. */
export function describedBy(...ids: Array<string | false>): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}

interface RoleCodePreviewProps {
  /** Referenced by the name field through `aria-describedby` while there is a code. */
  id: string;
  /** From `previewedRoleCode`. Nothing renders while it is empty. */
  code: string;
  testId: string;
}

/**
 * The code of a role under its name field. Two names can give one code, and
 * the server refuses the second: seeing the code is how a person tells why.
 */
export function RoleCodePreview({ id, code, testId }: RoleCodePreviewProps) {
  const t = useTranslations('roles.form');
  if (!code) return null;

  return (
    <p
      id={id}
      className="min-w-0 text-xs text-tertiary [overflow-wrap:anywhere]"
      data-testid={testId}
    >
      {t('codePreview', { code })}
    </p>
  );
}
