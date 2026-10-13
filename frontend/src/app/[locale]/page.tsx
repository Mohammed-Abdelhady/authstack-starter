import { Description, Heading } from '@/components/design-system';
import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { Rocket, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/LanguageSwitcher'; // feature:locale-ar
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

/**
 * Home Page
 *
 * Split-screen design matching AuthLayout and error pages aesthetic.
 * Left: Welcome message and CTAs | Right: Decorative illustration
 *
 * Features:
 * - Fully localized with direction-safe utilities
 * - Theme-aware with semantic color tokens
 * - Responsive design (illustration hidden on mobile)
 * - Accessible with proper ARIA attributes
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });

  return (
    <div className="relative min-h-screen bg-background text-foreground flex justify-center">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-2 p-4">
        <LanguageSwitcher /> {/* feature:locale-ar */}
        <ThemeSwitcher />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="max-w-screen-xl m-0 sm:m-20 bg-card shadow sm:rounded-lg flex justify-center flex-1 focus-visible:outline-none"
        data-testid="home-main"
      >
        {/* Left Side - Welcome Content */}
        <section className="lg:w-1/2 xl:w-5/12 p-6 sm:p-12 flex flex-col justify-center">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-start">
            {/* Main Heading */}
            <Heading level={1} variant="display" className="mb-4">
              {t('title')}
            </Heading>

            {/* Subtitle */}
            <p className="text-lg font-semibold text-primary mb-4 max-w-md">{t('subtitle')}</p>

            {/* Description */}
            <Description variant="lead" className="mb-8 max-w-md">
              {t('description')}
            </Description>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <Button asChild className="w-full sm:w-auto" data-testid="cta-primary-button">
                <Link href="/auth/login">
                  <ChevronRight className="w-5 h-5 me-2 rtl:rotate-180" />
                  {t('ctaPrimary')}
                </Link>
              </Button>
              <Button
                variant="outline"
                asChild
                className="w-full sm:w-auto"
                data-testid="cta-secondary-button"
              >
                <Link
                  href="https://github.com/Mohammed-Abdelhady/authstack-starter#readme"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('ctaSecondary')}
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Right Side - Illustration */}
        <div className="flex-1 bg-primary/10 text-center hidden lg:flex items-center justify-center">
          <div className="flex flex-col items-center justify-center p-12">
            <Rocket
              className="w-64 h-64 text-primary opacity-30"
              strokeWidth={1}
              aria-hidden="true"
            />
            <p className="mt-8 text-xl font-semibold text-primary">{t('illustrationSubtitle')}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
