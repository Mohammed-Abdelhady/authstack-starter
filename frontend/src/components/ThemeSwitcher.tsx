'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

function subscribeClientRender() {
  return () => undefined;
}

function clientRendered() {
  return true;
}

function serverRendered() {
  return false;
}

export function ThemeSwitcher() {
  const t = useTranslations('common');
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(subscribeClientRender, clientRendered, serverRendered);
  const isLight = resolvedTheme === 'light';
  const handleToggle = React.useCallback(
    () => setTheme(isLight ? 'dark' : 'light'),
    [isLight, setTheme],
  );

  if (!mounted) {
    return <div className="h-9 w-9" />; // Skeleton to prevent layout shift
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={isLight ? t('switchToDarkMode') : t('switchToLightMode')}
      data-testid="theme-switcher"
    >
      {isLight ? (
        <Moon className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Sun className="h-5 w-5" aria-hidden="true" />
      )}
    </Button>
  );
}
