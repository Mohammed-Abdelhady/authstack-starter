import { useTranslations } from 'next-intl';
import { ROLE_AUDIENCE, type RoleAudience } from '@app/core';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError } from '@/components/forms';
import { describedBy } from './RoleCodePreview';

const UNSET_AUDIENCE = 'unset';

interface Props {
  id: string;
  hintId: string;
  errorId: string;
  value: RoleAudience | undefined;
  error: string | undefined;
  busy: boolean;
  onChange: (value: RoleAudience | undefined) => void;
}

export function RoleAudienceField({
  id,
  hintId,
  errorId,
  value: audience,
  error,
  busy,
  onChange,
}: Props) {
  const t = useTranslations('roles.form');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('audienceLabel')}</Label>
      <Select
        value={audience ?? UNSET_AUDIENCE}
        onValueChange={(value) =>
          onChange(
            value === ROLE_AUDIENCE.CUSTOMER || value === ROLE_AUDIENCE.STAFF ? value : undefined,
          )
        }
        busy={busy}
      >
        <SelectTrigger
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(hintId, Boolean(error) && errorId)}
          data-testid="role-audience-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET_AUDIENCE}>{t('audienceUnset')}</SelectItem>
          <SelectItem value={ROLE_AUDIENCE.CUSTOMER}>{t('audienceCustomer')}</SelectItem>
          <SelectItem value={ROLE_AUDIENCE.STAFF}>{t('audienceStaff')}</SelectItem>
        </SelectContent>
      </Select>
      <p id={hintId} className="text-xs text-tertiary">
        {t('audienceHint')}
      </p>
      <FieldError id={errorId} message={error} testId="role-audience-error" />
    </div>
  );
}
