'use client';

import { useTranslations } from 'next-intl';
import { FormInput } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { CodeField } from './CodeField';
import type { AnswerFormData } from '../utils/answerSchema';
import { RECOVERY_CODE_FONT_SIZE } from '@/lib/config/form-styles';
import { cn } from '@/lib/utils';

interface TwoFactorAnswerFieldsProps {
  useRecoveryCode: boolean;
  onToggle: () => void;
  isBusy: boolean;
  /** False where another field above this one should take the focus first. */
  autoFocus?: boolean;
}

/**
 * The code box with a way to switch to a recovery code, shared by the sign-in
 * challenge and the disable dialog.
 */
export function TwoFactorAnswerFields({
  useRecoveryCode,
  onToggle,
  isBusy,
  autoFocus = true,
}: TwoFactorAnswerFieldsProps) {
  const t = useTranslations('auth.twoFactor');
  const tCommon = useTranslations('common');

  return (
    <>
      {useRecoveryCode ? (
        <FormInput<AnswerFormData>
          name="recoveryCode"
          label={t('recoveryCode')}
          placeholder={tCommon('recoveryCodePlaceholder')}
          autoComplete="one-time-code"
          required
          busy={isBusy}
          autoFocus={autoFocus}
          className={cn('text-center uppercase tracking-widest', RECOVERY_CODE_FONT_SIZE)}
          data-testid="two-factor-recovery-code-input"
        />
      ) : (
        <CodeField<AnswerFormData>
          name="code"
          label={t('code')}
          busy={isBusy}
          autoFocus={autoFocus}
          testId="two-factor-code-input"
        />
      )}

      <Button
        type="button"
        variant="link"
        className="min-h-6 h-auto p-0 text-sm"
        onClick={onToggle}
        data-testid="two-factor-toggle-recovery"
      >
        {useRecoveryCode ? t('useCode') : t('useRecoveryCode')}
      </Button>
    </>
  );
}
