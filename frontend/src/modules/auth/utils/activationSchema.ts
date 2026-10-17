import { z } from 'zod/v3';
import { zodName } from '@app/core';
import { createEmailCodeSchema } from './emailCodeSchema';
import { createPasswordSchema } from './passwordSchema';

export const createActivationSchema = (
  t: (key: string) => string,
  tPassword: (key: string) => string,
) =>
  createEmailCodeSchema(t)
    .extend({
      name: zodName({
        required: true,
        messages: {
          required: t('errors.nameRequired'),
          min: t('errors.nameMinLength'),
          max: t('errors.nameMaxLength'),
          pattern: t('errors.namePattern'),
          noLetter: t('errors.nameNoLetter'),
        },
      }),
      password: createPasswordSchema(tPassword),
      confirmPassword: z
        .string({ required_error: t('errors.confirmRequired') })
        .min(1, t('errors.confirmRequired')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('errors.passwordMismatch'),
      path: ['confirmPassword'],
    });
