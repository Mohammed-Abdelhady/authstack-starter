import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CodeBlock } from '@/components/ui/code-block';
import { Description, Heading } from '@/components/design-system';
import { PermissionGuard, RoutePermissionGuard } from '@/modules/permissions';
import {
  USER_PERMISSIONS,
  ROLE_PERMISSIONS,
  SESSION_PERMISSIONS,
  PERMISSION_PERMISSIONS,
  WILDCARD_PERMISSION,
} from '@app/core';
import { Button } from '@/components/ui/button';
import { Shield, Lock, Unlock, Users, Settings, Trash2, Edit, Eye } from 'lucide-react';

/**
 * Permissions Demo Page
 *
 * This page demonstrates various ways to use the permission system:
 * - Component-level guards (hide elements)
 * - Route-level guards (protect entire pages)
 * - Multiple permission checks
 * - Action button protection
 */
export default function PermissionsDemoPage() {
  const t = useTranslations('permissions.demo');
  const tCommon = useTranslations('common');
  return (
    <RoutePermissionGuard permission={PERMISSION_PERMISSIONS.MANAGE_ALL}>
      <div className="container mx-auto max-w-6xl space-y-8 py-8">
        {/* Page Header */}
        <div>
          <Heading level={1} variant="pageTitle" className="mt-8">
            {t('title')}
          </Heading>
          <Description className="mt-2">{t('description')}</Description>
        </div>

        {/* Single Permission Guard */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <Heading level={2} variant="sectionTitle">
              {t('singleTitle')}
            </Heading>
          </div>
          <Description>{t('singleDescription')}</Description>

          <div className="space-y-2">
            <PermissionGuard permission={USER_PERMISSIONS.LIST_ALL}>
              <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 dark:bg-green-950">
                <Unlock className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-800 dark:text-green-200">
                  {t('singleAllowed')}
                </span>
              </div>
            </PermissionGuard>

            <PermissionGuard permission="fake:permission:that:nobody:has">
              <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 dark:bg-red-950">
                <Lock className="h-4 w-4 text-red-600 dark:text-red-400" />
                <span className="text-sm text-red-800 dark:text-red-200">{t('singleDenied')}</span>
              </div>
            </PermissionGuard>
          </div>
        </section>

        {/* Multiple Permissions (ALL) */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <Heading level={2} variant="sectionTitle">
              {t('allTitle')}
            </Heading>
          </div>
          <Description>{t('allDescription')}</Description>

          <PermissionGuard permissions={[USER_PERMISSIONS.LIST_ALL, ROLE_PERMISSIONS.LIST_ALL]}>
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 dark:bg-green-950">
              <Unlock className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm text-green-800 dark:text-green-200">{t('allAllowed')}</span>
            </div>
          </PermissionGuard>

          <PermissionGuard permissions={[USER_PERMISSIONS.LIST_ALL, 'fake:permission']}>
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 dark:bg-red-950">
              <Lock className="h-4 w-4 text-red-600 dark:text-red-400" />
              <span className="text-sm text-red-800 dark:text-red-200">{t('allDenied')}</span>
            </div>
          </PermissionGuard>
        </section>

        {/* Any Permissions (OR) */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <Heading level={2} variant="sectionTitle">
              {t('anyTitle')}
            </Heading>
          </div>
          <Description>{t('anyDescription')}</Description>

          <PermissionGuard
            anyPermissions={[SESSION_PERMISSIONS.READ_ALL, SESSION_PERMISSIONS.READ_OWN]}
          >
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 dark:bg-green-950">
              <Unlock className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm text-green-800 dark:text-green-200">{t('anyAllowed')}</span>
            </div>
          </PermissionGuard>
        </section>

        {/* Action Buttons with Permission Guards */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <Heading level={2} variant="sectionTitle">
              {t('actionsTitle')}
            </Heading>
          </div>
          <Description>{t('actionsDescription')}</Description>

          {/* Sample user card */}
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
                  <Users className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-medium">{t('sampleName')}</p>
                  <p className="text-sm text-muted-foreground">{t('sampleEmail')}</p>
                </div>
              </div>

              {/* Action buttons - only shown if user has permissions */}
              <div className="flex flex-wrap gap-2">
                <PermissionGuard permission={USER_PERMISSIONS.READ_ALL}>
                  <Button size="sm" variant="outline">
                    <Eye className="me-2 h-4 w-4" />
                    {tCommon('view')}
                  </Button>
                </PermissionGuard>

                <PermissionGuard permission={USER_PERMISSIONS.UPDATE_ALL}>
                  <Button size="sm" variant="outline">
                    <Edit className="me-2 h-4 w-4" />
                    {tCommon('edit')}
                  </Button>
                </PermissionGuard>

                <PermissionGuard permission={USER_PERMISSIONS.DELETE_ALL}>
                  <Button size="sm" variant="destructive">
                    <Trash2 className="me-2 h-4 w-4" />
                    {tCommon('delete')}
                  </Button>
                </PermissionGuard>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-950">
            <p className="text-sm text-blue-800 dark:text-blue-200">{t('tip')}</p>
          </div>
        </section>

        {/* Fallback Content */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <Heading level={2} variant="sectionTitle">
              {t('fallbackTitle')}
            </Heading>
          </div>
          <Description>{t('fallbackDescription')}</Description>

          <PermissionGuard
            permission="this:permission:does:not:exist"
            fallback={
              <div className="rounded-md border border-dashed border-muted-foreground/50 p-4 text-center">
                <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">{t('fallbackDenied')}</p>
              </div>
            }
          >
            <div className="rounded-md bg-green-50 p-4 dark:bg-green-950">
              <p className="text-sm text-green-800 dark:text-green-200">{t('secretContent')}</p>
            </div>
          </PermissionGuard>
        </section>

        {/* Wildcard Permission */}
        <Alert variant="warning" role="note" className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <Heading level={2} variant="sectionTitle" className="text-inherit">
              {t('wildcardTitle')}
            </Heading>
          </div>
          <AlertDescription>{t('wildcardDescription')}</AlertDescription>

          <PermissionGuard permission={WILDCARD_PERMISSION}>
            <AlertDescription>
              <p className="text-sm font-medium">{t('wildcardNotice')}</p>
            </AlertDescription>
          </PermissionGuard>
        </Alert>

        {/* Code Examples */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <Heading level={2} variant="sectionTitle">
            {t('codeTitle')}
          </Heading>

          <div className="space-y-4">
            <div>
              <Heading level={3} variant="subsectionTitle" className="mb-2">
                {t('componentCodeTitle')}
              </Heading>
              <CodeBlock label={t('componentCodeTitle')}>
                {`import { PermissionGuard } from '@/modules/permissions';
import { USER_PERMISSIONS } from '@app/core';

<PermissionGuard permission={USER_PERMISSIONS.DELETE_ALL}>
  <Button variant="destructive">{t('common.delete')}</Button>
</PermissionGuard>`}
              </CodeBlock>
            </div>

            <div>
              <Heading level={3} variant="subsectionTitle" className="mb-2">
                {t('routeCodeTitle')}
              </Heading>
              <CodeBlock label={t('routeCodeTitle')}>
                {`import { RoutePermissionGuard } from '@/modules/permissions';
import { ROLE_PERMISSIONS } from '@app/core';

export default function RolesPage() {
  return (
    <RoutePermissionGuard permission={ROLE_PERMISSIONS.MANAGE_ALL}>
      <RoleManagementUI />
    </RoutePermissionGuard>
  );
}`}
              </CodeBlock>
            </div>

            <div>
              <Heading level={3} variant="subsectionTitle" className="mb-2">
                {t('allCodeTitle')}
              </Heading>
              <CodeBlock label={t('allCodeTitle')}>
                {`<PermissionGuard
  permissions={[USER_PERMISSIONS.LIST_ALL, ROLE_PERMISSIONS.LIST_ALL]}
>
  <AdminPanel />
</PermissionGuard>`}
              </CodeBlock>
            </div>

            <div>
              <Heading level={3} variant="subsectionTitle" className="mb-2">
                {t('anyCodeTitle')}
              </Heading>
              <CodeBlock label={t('anyCodeTitle')}>
                {`<PermissionGuard
  anyPermissions={[SESSION_PERMISSIONS.READ_ALL, SESSION_PERMISSIONS.READ_OWN]}
>
  <SessionsList />
</PermissionGuard>`}
              </CodeBlock>
            </div>
          </div>
        </section>
      </div>
    </RoutePermissionGuard>
  );
}
