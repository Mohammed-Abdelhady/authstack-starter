'use client';

import { useLocale } from 'next-intl';
import { useCallback, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LOCALE_OPTIONS = [
  { locale: 'en', label: 'English' },
  { locale: 'ar', label: 'العربية' }, // feature:locale-ar
] as const;

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const currentLocale = useLocale();

  // Only offer a locale the router actually serves; one is not a choice, so a
  // single-button switcher would do nothing.
  const routed = new Set<string>(routing.locales);
  const options = LOCALE_OPTIONS.filter((option) => routed.has(option.locale));
  const handleLanguageChange = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const option = LOCALE_OPTIONS.find(
        ({ locale }) => locale === event.currentTarget.dataset.locale,
      );
      if (option) router.replace(pathname, { locale: option.locale });
    },
    [pathname, router],
  );
  if (options.length < 2) return null;

  return (
    <div className="flex gap-2 items-center" data-testid="language-switcher">
      {options.map(({ locale, label }) => {
        const isCurrent = currentLocale === locale;

        return (
          <Button
            key={locale}
            type="button"
            onClick={handleLanguageChange}
            data-locale={locale}
            aria-current={isCurrent ? 'true' : undefined}
            data-testid={`language-switcher-${locale}`}
            variant={isCurrent ? 'default' : 'secondary'}
            size="sm"
            className={isCurrent ? 'forced-colors:underline' : undefined}
          >
            <span lang={locale}>{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
