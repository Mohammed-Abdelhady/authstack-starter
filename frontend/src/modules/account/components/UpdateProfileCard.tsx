'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { toast } from '@/lib/toast';
import { reportUnlessHandled } from '@/lib/requestFailure';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormInput, SubmitButton } from '@/components/forms';
import { useGetCurrentUserQuery, useUpdateProfileMutation } from '@/modules/auth/store';
import { useFormFieldTarget, useServerFieldErrors } from '@/hooks/useServerFieldErrors';
import { zodName } from '@app/core';
import { useSingleFlight } from '@/hooks/useSingleFlight';

const createUpdateProfileSchema = (t: (key: string) => string) =>
  z.object({
    name: zodName({
      required: true,
      messages: {
        required: t('nameRequired'),
        min: t('nameMinLength'),
        max: t('nameMaxLength'),
        pattern: t('namePattern'),
        noLetter: t('nameNoLetter'),
      },
    }),
  });

type UpdateProfileFormData = z.infer<ReturnType<typeof createUpdateProfileSchema>>;

/**
 * UpdateProfileCard Component
 * Allows users to update their profile information from the Settings page
 */
export function UpdateProfileCard() {
  const t = useTranslations('settings.profile');
  const { data: user } = useGetCurrentUserQuery();
  const [updateProfile, { isLoading }] = useUpdateProfileMutation();

  const updateProfileSchema = useMemo(() => createUpdateProfileSchema(t), [t]);

  const form = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: user?.name || '',
    },
  });
  const formRef = useRef<HTMLFormElement>(null);
  const applyServerFieldErrors = useServerFieldErrors(
    useFormFieldTarget(form.setError, formRef),
    isLoading,
  );

  useEffect(() => {
    if (user?.name) {
      form.reset({ name: user.name });
    }
  }, [user?.name, form]);

  const submit = async (data: UpdateProfileFormData) => {
    if (data.name === user?.name) {
      toast.info(t('noChanges'));
      return;
    }

    try {
      await updateProfile({ name: data.name }).unwrap();
      toast.success(t('success'));
    } catch (error) {
      applyServerFieldErrors(error);
      reportUnlessHandled(error);
    }
  };
  const onSubmit = useSingleFlight(submit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FormProvider {...form}>
          <form
            ref={formRef}
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="update-profile-form"
          >
            <FormInput<UpdateProfileFormData>
              name="name"
              label={t('name')}
              placeholder={t('namePlaceholder')}
              disabled={isLoading}
              data-testid="profile-name-input"
            />

            <div className="space-y-2">
              <Label htmlFor="profile-email" className="text-sm font-medium">
                {t('email')}
              </Label>
              <Input
                id="profile-email"
                dir="ltr"
                value={user?.email || ''}
                disabled
                className="bg-muted"
                data-testid="profile-email-input"
              />
              <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
            </div>

            <SubmitButton
              isLoading={isLoading}
              className="h-10 mt-0 w-full py-2"
              testId="update-profile-submit"
            >
              {t('submit')}
            </SubmitButton>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
