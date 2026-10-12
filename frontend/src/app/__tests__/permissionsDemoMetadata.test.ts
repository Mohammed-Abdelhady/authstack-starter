import { describe, expect, it, vi } from 'vitest';
import type { AppLocale } from '@/i18n/load-messages';
import { loadMessages } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: AppLocale; namespace: string }) => {
    const { createTranslator } = await import('next-intl');
    return createTranslator({ locale, messages: await loadMessages(locale), namespace });
  },
}));

import { generateMetadata } from '../[locale]/(dashboard)/admin/permissions-demo/page';

describe.each(['en', 'ar'] as const)('permissions demo metadata in %s', (locale) => {
  it('uses the title and description from the active catalogue', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale }) });
    const messages = await loadMessages(locale);

    expect(metadata).toEqual({
      title: lookupMessage(messages, 'permissions.demo.title'),
      description: lookupMessage(messages, 'permissions.demo.description'),
    });
  });
});
