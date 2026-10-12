'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyText, downloadRecoveryCodes, formatRecoveryCodes } from '../utils/clipboard';

interface RecoveryCodeListProps {
  codes: readonly string[];
}

/**
 * The codes plus the two ways to keep them. This is the only screen that ever
 * shows them, so both actions stay in reach.
 */
export function RecoveryCodeList({ codes }: RecoveryCodeListProps) {
  const t = useTranslations('settings.twoFactor.recoveryCodes');
  const [copyResult, setCopyResult] = useState<'copied' | 'failed' | null>(null);

  const onCopy = useCallback(async () => {
    setCopyResult((await copyText(formatRecoveryCodes(codes))) ? 'copied' : 'failed');
  }, [codes]);

  const onDownload = useCallback(() => downloadRecoveryCodes(codes), [codes]);

  return (
    <div className="space-y-3">
      <ul
        className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm"
        data-testid="two-factor-recovery-codes"
      >
        {codes.map((code) => (
          <li key={code} dir="ltr" className="text-center tracking-widest">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onCopy}
          data-testid="two-factor-copy-recovery-codes"
        >
          {copyResult === 'copied' ? (
            <Check className="me-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="me-2 h-4 w-4" aria-hidden="true" />
          )}
          {copyResult === 'copied' ? t('copied') : t('copy')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onDownload}
          data-testid="two-factor-download-recovery-codes"
        >
          <Download className="me-2 h-4 w-4" aria-hidden="true" />
          {t('download')}
        </Button>
      </div>
      {copyResult !== null && (
        <p
          role={copyResult === 'failed' ? 'alert' : 'status'}
          data-testid="two-factor-recovery-copy-status"
        >
          {copyResult === 'copied' ? t('copySuccess') : t('copyFailure')}
        </p>
      )}
    </div>
  );
}
