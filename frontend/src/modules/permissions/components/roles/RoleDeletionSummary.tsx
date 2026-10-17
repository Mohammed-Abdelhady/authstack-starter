import { useTranslations } from 'next-intl';
import type { Role } from '@/modules/roles/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import { cn } from '@/lib/utils';

export function RoleDeletionSummary({ role }: { role: Role }) {
  const t = useTranslations('roles.delete');
  const isProtected = role.isProtected;
  return (
    <div className="space-y-4 py-4">
      {isProtected ? (
        <Alert variant="warningSoft" role="note">
          <AlertDescription className={WRAP_ANYWHERE_CLASSES}>
            <strong>{t('protectedTitle')}</strong>{' '}
            {t.rich('protectedNotice', {
              name: role.name,
              strong: (chunks) => (
                <strong>
                  <span dir="auto">{chunks}</span>
                </strong>
              ),
            })}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div
            className={cn('rounded-lg border border-border bg-muted p-4', WRAP_ANYWHERE_CLASSES)}
          >
            <dl className="space-y-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{t('roleName')}</dt>
                <dd className="mt-1 text-sm text-foreground">
                  <span dir="auto" data-testid="delete-role-name">
                    {role.name}
                  </span>
                </dd>
              </div>
              {role.description && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('description')}</dt>
                  <dd className="mt-1 text-sm text-foreground">
                    <span dir="auto">{role.description}</span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{t('permissions')}</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {t('permissionsCount', { count: role.permissions.length })}
                </dd>
              </div>
            </dl>
          </div>

          <Alert variant="destructiveSoft" role="note">
            <AlertDescription>
              <strong>{t('warningTitle')}</strong> {t('warningNotice')}
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}
