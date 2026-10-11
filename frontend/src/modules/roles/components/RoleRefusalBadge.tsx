'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { RoleRefusal } from '../constants';

/** Says, beside a role that cannot be chosen, why not. */
export function RoleRefusalBadge({ refusal }: { readonly refusal: RoleRefusal }) {
  const t = useTranslations('permissions.userRole.refusal');

  return (
    <Badge variant="secondary" className="ms-2 text-xs">
      {t(refusal)}
    </Badge>
  );
}
