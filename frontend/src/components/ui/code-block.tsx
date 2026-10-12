import { useTranslations } from 'next-intl';

interface CodeBlockProps {
  children: string;
  testId?: string;
  /** Names the scroll region. Pass one when the page shows several samples. */
  label?: string;
}

export function CodeBlock({ children, testId, label }: CodeBlockProps) {
  const t = useTranslations('common');
  return (
    // Safari does not make an overflow container focusable, so the tab stop is explicit.
    <pre
      dir="ltr"
      role="region"
      aria-label={label ?? t('codeSample')}
      tabIndex={0}
      data-testid={testId}
      className="overflow-x-auto rounded-md bg-muted p-4 text-xs text-start ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <code>{children}</code>
    </pre>
  );
}
