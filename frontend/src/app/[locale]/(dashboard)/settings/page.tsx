import { EmailChangeCard } from '@/modules/account/email-change';
import { DeleteAccountCard } from '@/modules/account/deletion';
import { Description, Heading } from '@/components/design-system';
import { UpdateProfileCard } from '@/modules/account';
import { LinkedAccounts, ProfileSyncStatus } from '@/modules/account'; // feature:oauth-core
import { ChangePasswordCard } from '@/modules/auth/methods/password'; // feature:email-password
import { PasskeysCard } from '@/modules/passkeys'; // feature:passkeys
import { TwoFactorCard } from '@/modules/two-factor'; // feature:totp
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface SettingsPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Generate metadata for the settings page
 */
export async function generateMetadata({ params }: SettingsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings' });

  return {
    title: t('title'),
    description: t('description'),
  };
}

/**
 * Settings Page
 *
 * Groups the account cards under headings so the card titles (h3) follow an h2
 * instead of jumping straight from the page h1.
 */
export default async function SettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings' });

  return (
    <div className="container p-10">
      <div className="space-y-6">
        <div>
          <Heading level={1} variant="pageTitle">
            {t('title')}
          </Heading>
          <Description>{t('description')}</Description>
        </div>

        <section aria-labelledby="settings-account-group" className="space-y-4">
          <Heading level={2} variant="eyebrow" id="settings-account-group">
            {t('accountGroup')}
          </Heading>
          <div className="grid gap-6 md:grid-cols-2">
            <UpdateProfileCard />
            <EmailChangeCard />
            <DeleteAccountCard />
            <ChangePasswordCard /> {/* feature:email-password */}
            {/* feature:totp:start */}
            <TwoFactorCard />
            {/* feature:totp:end */}
            {/* feature:passkeys:start */}
            <PasskeysCard />
            {/* feature:passkeys:end */}
          </div>
        </section>

        {/* feature:oauth-core:start */}
        <section aria-labelledby="settings-integrations-group" className="space-y-4">
          <Heading level={2} variant="eyebrow" id="settings-integrations-group">
            {t('integrationsGroup')}
          </Heading>
          <div className="grid gap-6 md:grid-cols-2">
            <LinkedAccounts />
            <ProfileSyncStatus />
          </div>
        </section>
        {/* feature:oauth-core:end */}
      </div>
    </div>
  );
}
