'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Description } from '@/components/design-system';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetOwnEmailQuery } from '../api/ownEmailApi';
import { EmailCodeForm } from './EmailCodeForm';
import { NewAddressForm } from './NewAddressForm';

/**
 * The settings card for the person's own address: the address, the one
 * waiting to be confirmed, and the steps to change it. Client side for the
 * form state and the requests.
 */
export function EmailChangeCard() {
  const t = useTranslations('emailChange');
  const { data, isLoading, isError, refetch } = useGetOwnEmailQuery();
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return (
      <Skeleton
        className="h-40 w-full"
        aria-label={t('loading')}
        data-testid="email-change-card-loading"
      />
    );
  }

  return (
    <Card data-testid="email-change-card">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError || data === undefined ? (
          <div role="alert" className="space-y-2" data-testid="email-change-card-error">
            <Description>{t('loadError')}</Description>
            <Button variant="outline" onClick={() => void refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <>
            <dl className="space-y-1">
              <dt>
                <Description>{t('current')}</Description>
              </dt>
              <dd dir="ltr" className="break-all" data-testid="email-change-current">
                {data.email}
              </dd>
              {data.pendingEmail === undefined ? null : (
                <>
                  <dt>
                    <Description>{t('pending')}</Description>
                  </dt>
                  <dd dir="ltr" className="break-all" data-testid="email-change-pending">
                    {data.pendingEmail}
                  </dd>
                </>
              )}
            </dl>
            {editing ? (
              <NewAddressForm
                current={data.email}
                onSent={() => setEditing(false)}
                onCancel={() => setEditing(false)}
              />
            ) : data.pendingEmail === undefined ? (
              <Button
                variant="outline"
                onClick={() => setEditing(true)}
                data-testid="email-change-start"
              >
                {t('change')}
              </Button>
            ) : (
              <EmailCodeForm pending={data.pendingEmail} onOtherAddress={() => setEditing(true)} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
